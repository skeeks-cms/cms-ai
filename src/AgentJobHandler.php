<?php
namespace skeeks\cms\ai;

use skeeks\cms\job\contracts\JobReporterInterface;
use skeeks\cms\job\handlers\AbstractJobHandler;
use skeeks\cms\job\runtime\JobContext;
use skeeks\cms\job\exceptions\JobPermanentException;
use skeeks\cms\job\exceptions\JobTransientException;
use yii\db\Query;
use Yii;

final class AgentJobHandler extends AbstractJobHandler
{
    public function run(JobContext $context, JobReporterInterface $reporter): void
    {
        $run = $context->getRun();
        $row = (new Query())->from(DraftJob::TABLE)->where(['run_id'=>$run->id])->one();
        if (!$row) { throw new JobPermanentException('Чат удалён.'); }
        if ($row['done']) { return; }
        $key = trim((string)file_get_contents(Yii::getAlias('@root/frontend/runtime/skeeks-ai-bridge.key')));
        $auth = Yii::$app->security->decryptByKey($row['credential'],$key);
        if (!$auth) { throw new JobPermanentException('Авторизация задания недоступна.'); }
        $reporter->setStage('agent','Выполнение поручения');
        $reporter->heartbeat();
        $curl = curl_init(Yii::$app->params['aiAgentTurnUrl']);
        curl_setopt_array($curl,[
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>850,
            CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: '.$auth,'X-Skeeks-AI-Bridge: '.$key],
            CURLOPT_POSTFIELDS=>json_encode(['run'=>(int)$run->id,'chat'=>(int)$row['chat_id'],'lease'=>$run->execution_token]),
        ]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        if ($body===false || $status>=500) { throw new JobTransientException("Исполнитель временно недоступен ($status)."); }
        if ($status!==200 || empty(json_decode($body,true)['done'])) {
            throw new JobPermanentException("Исполнитель отклонил поручение ($status).");
        }
    }
}
