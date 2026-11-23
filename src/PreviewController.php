<?php

namespace skeeks\cms\ai;

use skeeks\cms\models\CmsTree;
use Yii;
use yii\web\Controller;
use yii\web\NotFoundHttpException;

final class PreviewController extends Controller
{
    public function actionView(int $id)
    {
        $ticket = (string)Yii::$app->request->headers->get('X-Skeeks-Preview');
        $site = (int)Yii::$app->skeeks->site->id;
        if (!Yii::$app->request->isGet || !preg_match('/^[A-Za-z0-9_-]{48}$/D',$ticket) ||
            Yii::$app->cache->get(['ai-preview',$ticket]) !== [$site,$id]) {
            throw new NotFoundHttpException();
        }
        $tree = CmsTree::findOne(['id'=>$id,'cms_site_id'=>$site,'active'=>'N']);
        if (!$tree || $tree->redirect || $tree->redirect_tree_id) { throw new NotFoundHttpException(); }
        Yii::$app->response->headers->set('Cache-Control','private, no-store');
        Yii::$app->response->headers->set('Referrer-Policy','no-referrer');
        Yii::$app->response->headers->set('X-Robots-Tag','noindex, nofollow');
        Yii::$app->user->setIdentity(null);
        Yii::$app->cms->setCurrentTree($tree);
        return Yii::$app->runAction('cms/tree/view');
    }
}
