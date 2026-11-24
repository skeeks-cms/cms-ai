<?php

namespace skeeks\cms\ai;

use skeeks\cms\admin\themes\AdminTheme;
use skeeks\cms\backend\widgets\BackendShellHeaderWidget;
use skeeks\cms\models\CmsCompany;
use skeeks\cms\widgets\admin\CrmCardBlocksWidget;
use yii\base\BootstrapInterface;
use yii\base\Event;
use yii\helpers\Html;

final class StandChat implements BootstrapInterface
{
    public function bootstrap($app)
    {
        $app->urlManager->addRules(['ai-panel/<action:api|sidebar|project-files|project-download|project-save|project-tree|project-upload|project-change>' => 'ai-panel/<action>'], false);
        Event::on(BackendShellHeaderWidget::class, BackendShellHeaderWidget::EVENT_BEFORE_RUN, static function ($event) {
            $header = $event->sender;
            if ($header->view->theme instanceof AdminTheme && !\Yii::$app->user->isGuest) {
                self::assets();
                $header->actions = self::button() . $header->actions;
            }
        });
        Event::on(CrmCardBlocksWidget::class, CrmCardBlocksWidget::EVENT_BLOCKS, static function ($event) {
            if ($event->owner instanceof CmsCompany && $event->position === CrmCardBlocksWidget::POSITION_ASIDE) {
                self::assets();
                $event->blocks['skeeks-ai'] = self::button((int)$event->owner->id);
            }
        });
    }

    private static function button(?int $company = null): string
    {
        return Html::button('SkeekS AI', [
            'type' => 'button', 'class' => 'btn btn-secondary btn-sm', 'data-sx-ai-open' => '',
            'data-sx-ai-company' => $company, 'aria-haspopup' => 'dialog',
        ]);
    }

    private static function assets(): void
    {
        $view = \Yii::$app->view;
        if (isset($view->params['skeeksAiPanel'])) {
            return;
        }
        $view->params['skeeksAiPanel'] = true;
        $panel = $view->renderFile(__DIR__ . '/panel.php');
        $view->on(\yii\web\View::EVENT_END_BODY, static function () use ($panel) {
            echo $panel;
        });
        $view->registerJs(file_get_contents(__DIR__ . '/chat.js'), \yii\web\View::POS_END, 'sx-ai-chat');
        $view->registerCss(file_get_contents(__DIR__ . '/panel.css'), [], 'sx-ai-panel');
    }
}
