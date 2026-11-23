<?php
namespace skeeks\cms\ai;

use Yii;
use yii\db\Query;
use yii\helpers\Html;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use skeeks\cms\job\models\CmsJobRun;

final class DraftJob
{
    public const TABLE = '{{%cms_ai_draft_job}}';
    public const TYPE = 'cms-ai.site-drafts';

    public static function tool(): \skeeks\cms\mcp\tools\CallbackTool
    {
        return new \skeeks\cms\mcp\tools\CallbackTool([
            'name' => 'cms_ai_site_drafts_create',
            'description' => 'Фоновая сборка сайта одним заданием: главная страница в черновике и две дочерние страницы, загрузка файла из вложений чата. Составь тексты страниц. Используй при запросе комплекта страниц.',
            'requiredScope' => 'cms.tree.write',
            'inputSchema' => [
                'type' => 'object', 'additionalProperties' => false, 'required' => ['pages','attachment_id'],
                'properties' => [
                    'pages' => ['type'=>'array','minItems'=>3,'maxItems'=>3,'items'=>[
                        'type'=>'object','required'=>['title','text'],'additionalProperties'=>false,
                        'properties'=>['title'=>['type'=>'string'],'text'=>['type'=>'string']],
                    ]],
                    'attachment_id'=>['type'=>'integer','description'=>'ID вложения в этом чате'],
                ],
            ],
            'callback' => [self::class, 'enqueue'],
        ]);
    }

    public static function enqueue(array $args): array
    {
        $db = Yii::$app->db;
        // The bridge supplies the chat and confirmation as headers, outside model arguments.
        $request = Yii::$app->request;
        $bridge = trim((string)file_get_contents(Yii::getAlias('@runtime/skeeks-ai-bridge.key')));
        if (!$bridge || !hash_equals($bridge, (string)$request->headers->get('X-Skeeks-AI-Bridge'))) {
            throw new ForbiddenHttpException();
        }
        $chatId = (int)$request->headers->get('X-Skeeks-AI-Chat');
        $key = (string)$request->headers->get('X-Skeeks-AI-Request');
        $site = Yii::$app->skeeks->site;
        $scope = ['id'=>$chatId, 'owner_id'=>Yii::$app->user->id, 'site_id'=>$site->id];
        $pages = $args['pages'] ?? [];
        if (!preg_match('/^[A-Za-z0-9_-]{20,64}$/D', $key) || !is_array($pages) || count($pages)!==3) {
            throw new BadRequestHttpException();
        }
        foreach ($pages as $page) {
            foreach (['title'=>180,'text'=>6000] as $field=>$limit) {
                if (!is_string($page[$field] ?? null) || trim($page[$field])==='' || mb_strlen($page[$field])>$limit) {
                    throw new BadRequestHttpException('Проверьте тексты страниц.');
                }
            }
        }
        return $db->transaction(function () use ($db,$chatId,$scope,$pages,$args,$key,$request,$bridge,$site) {
            $chat = $db->createCommand('SELECT * FROM {{%cms_ai_chat}} WHERE id=:id FOR UPDATE',[':id'=>$chatId])->queryOne();
            if (!$chat || array_diff_assoc($scope,$chat)) { throw new ForbiddenHttpException(); }
            $where = ['chat_id'=>$chatId,'request_key'=>$key];
            $row = (new Query())->from(self::TABLE)->where($where)->one();
            if ($row) { return ['run_id'=>(int)$row['run_id']]; }
            if (!self::attachment($chatId,(int)$args['attachment_id'])->exists()) {
                throw new BadRequestHttpException('Файл отсутствует в выбранном чате.');
            }
            $token = Yii::$app->cmsMcp->currentAccessToken;
            $upload = Yii::$app->cmsMcp->getTool('cms_storage_file_upload');
            if (!$token->hasScope($upload->getRequiredScope()) || !Yii::$app->cmsMcp->canExecuteTool($upload)) {
                throw new ForbiddenHttpException();
            }
            $run = Yii::$app->jobs->push(self::TYPE, ['pages'=>$pages,'attachment_id'=>(int)$args['attachment_id']], [
                'siteId'=>$site->id,'createdBy'=>Yii::$app->user->id,'triggerRef'=>(string)$chatId,
            ]);
            $db->createCommand()->insert(self::TABLE, $where + [
                'run_id'=>$run->id,'results'=>'[]',
                'credential'=>Yii::$app->security->encryptByKey($request->headers->get('Authorization'),$bridge),
            ])->execute();
            return ['run_id'=>(int)$run->id,'message'=>'Задание №'.$run->id.' принято. Ссылки появятся в этом чате.'];
        });
    }

    private static function attachment(int $chat, int $file): Query
    {
        return (new Query())->from(['a'=>'{{%cms_ai_attachment}}'])->innerJoin(['m'=>'{{%cms_ai_chat_message}}'],'m.id=a.message_id')
            ->where(['a.id'=>$file,'m.chat_id'=>$chat]);
    }

    public static function step(array $input, $token): array
    {
        $db = Yii::$app->db;
        return $db->transaction(function () use ($db,$input,$token) {
            $id = (int)$input['run'];
            $row = $db->createCommand('SELECT * FROM {{%cms_ai_draft_job}} WHERE run_id=:id FOR UPDATE',[':id'=>$id])->queryOne();
            $run = CmsJobRun::findOne($id);
            $site = Yii::$app->skeeks->site;
            if (!$row || !$run || $run->job_type!==self::TYPE || $run->status!=='running' || !$run->execution_token ||
                !hash_equals($run->execution_token,(string)$input['lease']) || $run->lease_until<time() ||
                $run->created_by!=Yii::$app->user->id || $run->cms_site_id!=$site->id) { throw new ForbiddenHttpException(); }
            $results = json_decode($row['results'],true,32,JSON_THROW_ON_ERROR);
            $index = count($results);
            $payload = $run->getPayload();
            $api = Yii::$app->cmsMcp;
            if (!$row['done'] && $index===(int)$input['index']) {
                if ($index===0) {
                    $file = self::attachment($row['chat_id'],$payload['attachment_id'])->select(['a.name','a.content'])->one();
                    if (!$file) { throw new BadRequestHttpException('Вложение удалено.'); }
                    $saved = $api->executeTool('cms_storage_file_upload',['cluster_id'=>Yii::$app->params['aiJobStorageCluster'] ?? null,'filename'=>$file['name'],'base64'=>base64_encode($file['content']),'cms_site_id'=>(int)$site->id],$token);
                    $result = ['id'=>$saved['id'],'name'=>$file['name'],'url'=>$saved['url']];
                } else {
                    $page = $payload['pages'][$index-1];
                    $parent = $index===1 ? $site->rootCmsTree->id : $results[1]['id'];
                    $content = Html::tag('p',nl2br(Html::encode($page['text'])));
                    if ($index===1) { $content .= Html::a(Html::encode($results[0]['name']),$results[0]['url']); }
                    $saved = $api->executeTool('cms_tree_create', [
                        'parent_id'=>(int)$parent,'name'=>$page['title'],'code'=>"ai-$id-$index",
                        'publish'=>false,'attributes'=>['description_full'=>$content],
                    ],$token);
                    if ($saved['published']) { throw new \RuntimeException('Страница должна быть черновиком.'); }
                    $url = \skeeks\cms\backend\helpers\BackendUrlHelper::createByParams(['/cms/admin-tree/update','pk'=>$saved['id']])->url;
                    $result = ['id'=>$saved['id'],'name'=>$page['title'],'url'=>\yii\helpers\Url::to($url,true)];
                }
                $results[] = $result;
                $changes = ['results'=>json_encode($results,JSON_THROW_ON_ERROR)];
                if (count($results)===4) {
                    $text = "Готовы три черновика и файл. Задание №$id.\n";
                    foreach ($results as $item) { $text .= "\n".$item['name']." — ".$item['url']; }
                    $db->createCommand()->insert('{{%cms_ai_chat_message}}', ['chat_id'=>$row['chat_id'],'role'=>'assistant','text'=>$text,'created_at'=>time()])->execute();
                    $changes += ['done'=>1,'credential'=>null];
                }
                $db->createCommand()->update(self::TABLE,$changes,['run_id'=>$id])->execute();
            }
            return ['count'=>count($results),'results'=>$results];
        });
    }
}
