<?php
namespace skeeks\cms\ai;

use skeeks\cms\rbac\CmsManager;
use Yii;
use yii\db\Query;
use yii\web\BadRequestHttpException;
use yii\web\ConflictHttpException;
use yii\web\ForbiddenHttpException;

final class ProjectKnowledge
{
    public static function settings(int $site, array $data): array
    {
        $table = '{{%cms_ai_project}}';
        $canEdit = Yii::$app->user->can(CmsManager::PERMISSION_ROLE_ADMIN_ACCESS);
        if ($data['op'] === 'saveSettings') {
            if (!$canEdit) {
                throw new ForbiddenHttpException();
            }
            $values = [];
            foreach (['instructions','skills'] as $field) {
                $value = $data[$field] ?? null;
                if (!is_string($value) || mb_strlen($value) > 12000) {
                    throw new BadRequestHttpException('Превышен размер настроек.');
                }
                $values[$field] = trim($value);
            }
            if ($values['skills'] !== '' && !preg_match('/^## [^\\r\\n]+\\R.+/su', $values['skills'])) {
                throw new BadRequestHttpException('Начните навык строкой «## Название», ниже запишите инструкции.');
            }
            $rev = (int)$data['revision'];
            $db = Yii::$app->db;
            $db->createCommand()->upsert($table, ['site_id'=>$site,'instructions'=>'','skills'=>'','revision'=>0], false)->execute();
            if (!$db->createCommand()->update($table,$values + ['revision'=>$rev+1],['site_id'=>$site,'revision'=>$rev])->execute()) {
                throw new ConflictHttpException('Настройки изменились. Откройте их заново.');
            }
        }
        $row = (new Query())->from($table)->where(['site_id'=>$site])->one();
        return ['canEdit'=>$canEdit] + ($row ?: ['instructions'=>'','skills'=>'','revision'=>0]);
    }
}
