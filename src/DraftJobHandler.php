<?php
namespace skeeks\cms\ai;

use skeeks\cms\job\contracts\JobReporterInterface;
use skeeks\cms\job\handlers\AbstractJobHandler;
use skeeks\cms\job\runtime\JobContext;
use skeeks\cms\job\exceptions\JobTransientException;
use skeeks\cms\job\exceptions\JobPermanentException;
use yii\db\Query;

final class DraftJobHandler extends AbstractJobHandler
{
    public function run(JobContext $context, JobReporterInterface $reporter): void
    {
        $run = $context->getRun();
        $row = (new Query())->from(DraftJob::TABLE)->where(['run_id'=>$run->id])->one();
        if (!$row) { throw new JobPermanentException('Чат задания удалён.'); }
        if ($row['done']) { $reporter->setResult(json_decode($row['results'],true)); return; }
        $key = trim((string)file_get_contents(\Yii::getAlias('@root/frontend/runtime/skeeks-ai-bridge.key')));
        $authorization = \Yii::$app->security->decryptByKey($row['credential'],$key);
        if (!$authorization) { throw new JobPermanentException('Не удалось получить авторизацию задания.'); }
        $workspace = $context->getWorkspace();
        $file = $workspace->path('pages.json');
        $tmp = $workspace->path('pages.tmp');
        if (!is_file($file)) {
            if (file_put_contents($tmp,json_encode($context->getPayload()['pages'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR))===false || !rename($tmp,$file)) {
                throw new JobTransientException('Не удалось записать план страниц.');
            }
        }
        $index = count(json_decode($row['results'],true,32,JSON_THROW_ON_ERROR));
        $reporter->setStage('drafts','Создание черновиков');
        $reporter->heartbeat();
        $endpoint = \Yii::$app->params['aiJobEndpoint'];
        $curl = curl_init($endpoint['url']);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>45,
            CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: '.$authorization,
                'X-Skeeks-AI-Bridge: '.$key,'Host: '.$endpoint['host']],
            CURLOPT_POSTFIELDS=>json_encode(['op'=>'draftStep','run'=>(int)$run->id,'lease'=>$run->execution_token,'index'=>$index]),
        ]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        if (!$body || $status>=500) { throw new JobTransientException("Сайт временно недоступен ($status)."); }
        if ($status!==200) { throw new JobPermanentException("Сайт отклонил шаг задания ($status)."); }
        $step = json_decode($body,true,32,JSON_THROW_ON_ERROR);
        $reporter->info('Сохранено объектов: '.$step['count'].' из 4.');
        if ($step['count']<4) { $context->requestRequeue(); }
        $reporter->setResult($step['results']);
    }
}
