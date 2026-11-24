<?php
namespace skeeks\cms\ai;

use skeeks\cms\ai\service\ProjectRulesStore;
use skeeks\cms\rbac\CmsManager;
use Yii;
use yii\web\ForbiddenHttpException;

/** Rules and skills of the site's project: the administrator right here, storage in the central service (ProjectRulesStore). */
final class ProjectKnowledge
{
    public static function settings(int $site, array $data): array
    {
        $canEdit = Yii::$app->user->can(CmsManager::PERMISSION_ROLE_ADMIN_ACCESS);
        if (($data['op'] ?? '') === 'saveSettings') {
            if (!$canEdit) {
                throw new ForbiddenHttpException();
            }
            $user = Yii::$app->user->isGuest ? null : (int)Yii::$app->user->id;
            return ['canEdit' => true] + ProjectRulesStore::save($site, $user, (int)($data['revision'] ?? 0), $data['instructions'] ?? null, $data['skills'] ?? null);
        }
        return ['canEdit' => $canEdit] + ProjectRulesStore::get($site);
    }
}
