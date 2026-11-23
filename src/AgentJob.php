<?php
namespace skeeks\cms\ai;

use skeeks\cms\job\models\CmsJobRun;
use Yii;
use yii\db\Query;
use yii\web\ConflictHttpException;
use yii\web\ForbiddenHttpException;

final class AgentJob
{
    public const TYPE = 'cms-ai.agent-turn';

    /** Caller holds the authenticated chat's row lock. */
    public static function handle(string $op, array $chat, array $data, string $key): array
    {
        $db = Yii::$app->db;
        $chatId = (int)$chat['id'];
        if ($op === 'queueAgent') {
            $messageId = (int)$data['messageId'];
            $where = ['id'=>$messageId,'chat_id'=>$chatId,'role'=>'user'];
            $message = (new Query())->from('{{%cms_ai_chat_message}}')->where($where)->one();
            if (!$message) { throw new ForbiddenHttpException(); }
            $confirmation = $data['confirmation'] ?? null;
            $requestKey = hash('sha256', $messageId.'|'.$confirmation);
            $binding = ['chat_id'=>$chatId,'request_key'=>$requestKey];
            $prior = (new Query())->from(DraftJob::TABLE)->where($binding)->one();
            if ($prior) { return ['id'=>(int)$prior['run_id']]; }
            $payload = ['messageId'=>$messageId];
            if ($confirmation !== null) {
                $pending = json_decode($chat['pending'] ?? 'null',true);
                if (!$pending || $pending['id'] !== $confirmation || ($pending['messageId'] ?? null) !== $messageId) {
                    throw new ConflictHttpException('Подтверждение уже обработано.');
                }
                $payload['confirmed'] = $pending;
            }
            $run = Yii::$app->jobs->push(self::TYPE,$payload,[
                'siteId'=>$chat['site_id'],'createdBy'=>$chat['owner_id'],'triggerRef'=>(string)$chatId,
            ]);
            $credential = Yii::$app->security->encryptByKey(Yii::$app->request->headers->get('Authorization'),trim($key));
            $db->createCommand()->insert(DraftJob::TABLE,$binding+['run_id'=>$run->id,'results'=>'[]','credential'=>$credential])->execute();
            self::message($chatId,'Задание №'.$run->id.' принято в работу.',null);
            return ['id'=>(int)$run->id];
        }

        $id = (int)$data['run'];
        $row = $db->createCommand('SELECT * FROM {{%cms_ai_draft_job}} WHERE run_id=:id AND chat_id=:chat FOR UPDATE',
            [':id'=>$id,':chat'=>$chatId])->queryOne();
        $run = CmsJobRun::findOne($id);
        if (!$row || !$run || $run->job_type !== self::TYPE || $run->status !== 'running'
            || !$run->execution_token || !hash_equals($run->execution_token,(string)$data['lease'])
            || $run->created_by != $chat['owner_id'] || $run->cms_site_id != $chat['site_id'] || $run->lease_until < time()) { throw new ForbiddenHttpException(); }
        if ($row['done']) { return ['done'=>true]; }
        $state = json_decode($row['results'],true);
        if ($op === 'agentClaimWrite') {
            if (!empty($state['claimed'])) { return ['claimed'=>false]; }
            $state['claimed'] = true;
        } elseif ($op === 'agentWriteResult') {
            $state['outcome'] = $data['outcome'];
        } elseif ($op === 'agentFinish') {
            $messageId = self::message($chatId,$data['text'],$data['pending'] ?? null);
            $files = $data['screenshots'] ?? [];
            if (count($files)>4) { throw new \yii\web\BadRequestHttpException(); }
            foreach ($files as $file) {
                $bytes = base64_decode($file['base64'],true);
                if (!$bytes || strlen($bytes)>1000000 || substr($bytes,0,3)!=="\xff\xd8\xff" ||
                    !preg_match('/^preview-[0-9]+-(phone|desktop)\.jpg$/D',$file['name'])) {
                    throw new \yii\web\BadRequestHttpException();
                }
                $db->createCommand()->insert('{{%cms_ai_attachment}}',['message_id'=>$messageId,
                    'name'=>$file['name'],'size'=>strlen($bytes),'content'=>$bytes])->execute();
            }
            $db->createCommand()->update(DraftJob::TABLE,['done'=>1,'credential'=>null],['run_id'=>$id])->execute();
            return ['done'=>true];
        } else {
            $payload = $run->getPayload();
            $message = (new Query())->from('{{%cms_ai_chat_message}}')->where(['chat_id'=>$chatId,'id'=>$payload['messageId']])->select('text')->scalar();
            return ['message'=>$message,'messageId'=>$payload['messageId'],'confirmed'=>$payload['confirmed'] ?? null,'state'=>$state];
        }
        $db->createCommand()->update(DraftJob::TABLE,['results'=>json_encode($state,JSON_THROW_ON_ERROR)],['run_id'=>$id])->execute();
        return $state;
    }

    private static function message(int $id,string $text,?array $pending): int
    {
        $db = Yii::$app->db;
        $db->createCommand()->insert('{{%cms_ai_chat_message}}',['chat_id'=>$id,'role'=>'assistant','text'=>$text,'created_at'=>time()])->execute();
        $messageId = (int)$db->lastInsertID;
        $db->createCommand()->update('{{%cms_ai_chat}}',['updated_at'=>time(),'pending'=>$pending?json_encode($pending,JSON_THROW_ON_ERROR):null],['id'=>$id])->execute();
        return $messageId;
    }
}
