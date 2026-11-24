<?php

namespace skeeks\cms\ai;

use skeeks\cms\ai\service\RunBridge;
use skeeks\cms\mcp\controllers\BearerAuthenticatedController;
use Yii;
use yii\db\Query;
use yii\helpers\Url;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\NotFoundHttpException;
use yii\web\Response;

final class ChatStoreController extends BearerAuthenticatedController
{
    private const CHAT = '{{%cms_ai_chat}}';
    private const SESSION = '{{%cms_ai_engine_session}}';
    private const MESSAGE = '{{%cms_ai_chat_message}}';

    protected function resourceUri(): string
    {
        return rtrim(Url::to($this->mcp()->restResourceRoute, true), '/');
    }

    public function actionIndex(): array
    {
        $request = Yii::$app->request;
        Yii::$app->response->format = Response::FORMAT_JSON;
        Yii::$app->response->headers->set('Cache-Control', 'no-store');
        $key = @file_get_contents(Yii::getAlias('@runtime/skeeks-ai-bridge.key'));
        if (!$request->isPost || !$key || !hash_equals(trim($key), (string)$request->headers->get('X-Skeeks-AI-Bridge'))) {
            throw new ForbiddenHttpException();
        }
        $token = $this->authenticateBearer();
        $scope = ['owner_id' => (int)Yii::$app->user->id, 'site_id' => (int)Yii::$app->skeeks->site->id];
        $data = json_decode($request->rawBody, true, 32, JSON_THROW_ON_ERROR);
        $db = Yii::$app->db;
        $chats = (new Query())->from(self::CHAT)->where($scope);
        $op = $data['op'];
        if ($op === 'draftStep') { return DraftJob::step($data,$token); }
        if (in_array($op, ['settings','saveSettings'], true)) {
            return ProjectKnowledge::settings($scope['site_id'], $data);
        }
        $where = $scope + ['id' => (int)$data['id']];
        return $db->transaction(function () use ($db,$data,$op,$where,$chats,$token) {
            $executor = in_array($op, RunBridge::OPS, true);
            if ($executor) {
                $db->createCommand('SELECT id FROM {{%cms_ai_chat}} WHERE id=:id FOR UPDATE',[':id'=>$where['id']])->queryScalar();
            }
            $chat = $chats->andWhere(['id'=>$where['id']])->one();
            if (!$chat) {
                throw new NotFoundHttpException();
            }
            if ($executor) {
                return RunBridge::handle($op,$chat,$data);
            }
            if ($op === 'previewTree') {
                $treeId = (int)$data['treeId'];
                $api = Yii::$app->cmsMcp;
                $record = $api->executeTool('cms_tree_get', ['id'=>$treeId], $token);
                if ((int)$record['cms_site_id'] !== (int)$chat['site_id']) {
                    throw new ForbiddenHttpException();
                }
                if ($record['published']) {
                    $path = parse_url($record['url'], PHP_URL_PATH);
                    if (!is_string($path) || !preg_match('~^/(?!/)[^\\\\?#]*$~D', $path)) {
                        throw new BadRequestHttpException('Некорректный адрес раздела.');
                    }
                    return ['path'=>$path];
                }
                $ticket = Yii::$app->security->generateRandomString(48);
                if (!Yii::$app->cache->set(['ai-preview',$ticket],[(int)$chat['site_id'],$treeId],60)) {
                    throw new \RuntimeException('Не удалось подготовить предпросмотр.');
                }
                return ['path'=>Url::to(['/ai-preview/view','id'=>$treeId]),'ticket'=>$ticket];
            }
            $attachments = (new Query())->from(['a'=>'{{%cms_ai_attachment}}'])
                ->innerJoin(['m'=>self::MESSAGE], 'm.id = a.message_id')->where(['m.chat_id'=>$chat['id']]);
            if ($op === 'file') {
                $file = $attachments->select(['a.name','a.content'])->andWhere(['a.id'=>(int)$data['fileId']])->one();
                if (!$file) {
                    throw new NotFoundHttpException();
                }
                return ['name'=>$file['name'],'base64'=>base64_encode($file['content'])];
            }
            if ($op === 'get') {
                $sessions = (new Query())->from(self::SESSION)
                    ->where(['chat_id' => $chat['id']])->select(['session_id', 'engine'])->indexBy('engine')->column();
                // A worker from before the migration may still finish its first turn.
                if ($chat['thread_id'] !== null && !isset($sessions['codex'])) {
                    $sessions['codex'] = $chat['thread_id'];
                }
                $chat['engine_sessions'] = (object)$sessions;
                $chat['catalog_revs'] = (object)(new Query())->from(self::SESSION)->where(['chat_id' => $chat['id']])
                    ->andWhere(['not', ['catalog_rev' => null]])->select(['catalog_rev', 'engine'])->indexBy('engine')->column();
                $chat['pending'] = json_decode($chat['pending'] ?? 'null', true);
                $chat['history'] = (new Query())->from(self::MESSAGE)->where(['chat_id'=>$chat['id']])
                    ->select(['id','role','text'])->orderBy('id')->all();
                $chat['draft_job'] = (new Query())->from(['d'=>DraftJob::TABLE])
                    ->innerJoin(['r'=>'{{%cms_job_run}}'],'r.id=d.run_id')
                    ->select(['r.id','r.status','r.job_type','d.done'])->where(['d.chat_id'=>$chat['id']])->orderBy(['r.id'=>SORT_DESC])->one() ?: null;
                $chat['files'] = $attachments->select(['a.id','a.name','a.size','a.message_id'])->orderBy('a.id')->all();
                return $chat;
            }
            if ($op === 'catalogSeen') {
                $rev = (string)($data['rev'] ?? '');
                if (!preg_match('/^[a-f0-9]{32}$/D', $rev)) {
                    throw new BadRequestHttpException();
                }
                $db->createCommand()->update(self::SESSION, ['catalog_rev' => $rev],
                    ['chat_id' => $chat['id'], 'engine' => (string)($data['engine'] ?? '')])->execute();
                return ['ok' => true];
            }
            $changes = ['updated_at' => time()];
            if ($op === 'bindEngine' || $op === 'thread') {
                $engine = $op === 'thread' ? 'codex' : ($data['engine'] ?? null);
                $session = $op === 'thread' ? ($data['thread'] ?? null) : ($data['session'] ?? null);
                if ($engine !== $chat['engine']
                    || !is_string($session) || $session === '' || mb_strlen($session) > 255
                    || ($engine === 'codex' && (!preg_match('/^[a-f0-9-]{36}$/D', $session)
                        || ($chat['thread_id'] !== null && $chat['thread_id'] !== $session)))) {
                    throw new BadRequestHttpException('Некорректная привязка сессии.');
                }
                $binding = ['chat_id' => $chat['id'], 'engine' => $engine];
                $db->createCommand()->upsert(self::SESSION, $binding + ['session_id' => $session], false)->execute();
                $bound = (new Query())->select('session_id')->from(self::SESSION)->where($binding)->scalar();
                if ($bound !== $session) {
                    throw new BadRequestHttpException('Несовпадение сессии движка.');
                }
                if ($engine === 'codex') {
                    $changes['thread_id'] = $session;
                }
            } else {
                throw new BadRequestHttpException();
            }
            $db->createCommand()->update(self::CHAT,$changes,$where)->execute();
            return ['ok'=>true];
        });
    }
}
