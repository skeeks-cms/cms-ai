<?php
use skeeks\cms\widgets\formInputs\attachments\AttachmentsInputWidget;
use skeeks\cms\widgets\formInputs\richText\RichTextInputWidget;

$icon = static function (string $path): string {
    return '<svg class="sx-ai-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' . $path . '"/></svg>';
};
?>
<dialog class="sx-ai-panel" data-project-write="<?= (int)\skeeks\cms\ai\ProjectFiles::allowed(true) ?>" aria-label="SkeekS AI">
<header>
<button type="button" class="sx-ai-iconbtn" id="sx-ai-toggleChats" aria-expanded="false" aria-controls="sx-ai-sidebar" title="Чаты"><?= $icon('M4 6h16M4 12h16M4 18h16') ?><span>Чаты</span></button>
<strong>SkeekS AI</strong>
<span class="sx-ai-spacer"></span>
<button type="button" class="sx-ai-iconbtn" id="sx-ai-toggleSide" aria-expanded="false" aria-controls="sx-ai-side" title="Панель чата"><?= $icon('M4 5h16v14H4zM15 5v14') ?><span>Панель</span></button>
<button type="button" class="sx-ai-iconbtn" data-sx-ai-close title="Закрыть"><?= $icon('M6 6l12 12M18 6L6 18') ?><span>Закрыть</span></button>
</header>
<main>
<nav id="sx-ai-sidebar" aria-label="Мои чаты">
<button type="button" class="sx-ai-navrow" id="sx-ai-newChat"><?= $icon('M12 5v14M5 12h14') ?>Новый чат</button>
<button type="button" class="sx-ai-navrow" id="sx-ai-searchToggle" aria-expanded="false" aria-controls="sx-ai-search"><?= $icon('M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4.2-4.2') ?>Поиск</button>
<input class="form-control" type="search" id="sx-ai-search" maxlength="200" placeholder="Название или текст сообщения" aria-label="Поиск по названиям и сообщениям" hidden>
<div id="sx-ai-listStatus" role="status"></div>
<div id="sx-ai-chats"></div>
</nav>
<section class="sx-ai-conversation" aria-label="Переписка" data-sx-attach-zone><div class="sx-ai-dropzone" aria-hidden="true"><div><?= $icon('M12 16V4M7 9l5-5 5 5M5 20h14') ?><strong>Отпустите, чтобы прикрепить</strong><span>До 4 файлов, вместе до 4 МБ</span></div></div><div id="sx-ai-scroll"><h2 id="sx-ai-title"></h2><p id="sx-ai-context"></p><section id="sx-ai-messages" aria-live="polite"></section><aside hidden id="sx-ai-preview" class="sx-ai-pending"><strong>Действие в CRM</strong><div class="sx-ai-pending-body"></div><div class="sx-ai-actions"><button type="button" class="sx-button sx-button--primary" id="sx-ai-confirm">Подтвердить</button><button type="button" class="sx-button sx-button--secondary" id="sx-ai-reject">Отклонить</button></div></aside></div><div class="sx-ai-composer">
<div id="sx-ai-queue" class="sx-ai-queue" hidden><span class="sx-ai-queue-label">В очереди:</span> <span id="sx-ai-queueText"></span><button type="button" class="sx-ai-iconbtn" id="sx-ai-queueSend" title="Передать сообщение агенту сейчас, не дожидаясь ответа"><?= $icon('M12 19V5M6 11l6-6 6 6') ?><span>Дослать сейчас</span></button><button type="button" class="sx-ai-iconbtn" id="sx-ai-queueCancel" title="Убрать из очереди"><?= $icon('M6 6l12 12M18 6L6 18') ?><span>Убрать</span></button></div>
<form class="sx-ai-box">
<?= AttachmentsInputWidget::widget(['name' => 'uploads', 'maxSize' => 4194304, 'options' => ['id' => 'sx-ai-files']]) ?>
<div class="sx-ai-box-row">
<button type="button" class="sx-ai-round" data-sx-attach-open="sx-ai-files" title="Прикрепить файлы: до 4, вместе до 4 МБ. Можно перетащить или вставить из буфера" aria-label="Прикрепить файлы"><?= $icon('M12 5v14M5 12h14') ?></button>
<?= RichTextInputWidget::widget([
    'name' => 'message', 'options' => ['id' => 'sx-ai-message'],
    'preset' => 'basic', 'tools' => [], 'paragraph' => 'div', 'minHeight' => 24,
    'placeholder' => 'Напишите сообщение…', 'attachLabel' => 'Прикрепить файлом',
    'uploadUrl' => null,
]) ?>
<button type="button" class="sx-ai-round" id="sx-ai-mic" hidden title="Голосовой ввод" aria-label="Голосовой ввод" aria-pressed="false"><?= $icon('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3') ?></button>
<button type="submit" class="sx-ai-send" id="sx-ai-send" aria-label="Отправить" title="Отправить (Enter)"><?= $icon('M12 19V5M6 11l6-6 6 6') ?></button>
<button type="button" class="sx-ai-send is-stop" id="sx-ai-stop" hidden aria-label="Остановить" title="Остановить поручение"><svg class="sx-ai-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg></button>
</div>
</form>
<div class="sx-ai-box-meta">
<label id="sx-ai-engineLabel" class="sx-ai-chip" title="Движок нового чата"><span class="sx-ai-visually-hidden">Движок нового чата</span><select id="sx-ai-engine"></select></label>
<span id="sx-ai-engineName" class="sx-ai-chip" hidden></span>
<label id="sx-ai-modelLabel" class="sx-ai-chip" hidden title="Модель для следующего поручения"><span class="sx-ai-visually-hidden">Модель</span><select id="sx-ai-model"></select></label>
<label id="sx-ai-effortLabel" class="sx-ai-chip" hidden title="Глубина рассуждений: выше — точнее, но дольше и больше токенов"><span class="sx-ai-visually-hidden">Глубина рассуждений</span><select id="sx-ai-effort"></select></label>
<span class="sx-ai-spacer"></span>
<p id="sx-ai-job" role="status"></p>
</div>
<p id="sx-ai-status" role="status"></p>
</div></section>
<div id="sx-ai-side" class="sx-ai-side" role="complementary" aria-label="Панель чата">
<div class="sx-ai-side-head"><strong>Панель чата</strong><button type="button" class="sx-ai-iconbtn" id="sx-ai-closeSide" title="Скрыть панель"><?= $icon('M6 6l12 12M18 6L6 18') ?><span>Скрыть</span></button></div>
<details class="sx-ai-side-section" id="sx-ai-sideProject"><summary><span class="sx-ai-row-title">Проект чата</span><span class="sx-ai-row-value"></span></summary>
<label id="sx-ai-groupLabel" hidden>Проект CRM<select class="form-control" id="sx-ai-group"></select></label>
<p id="sx-ai-groupNote" class="sx-ai-note"></p>
</details>
<details class="sx-ai-side-section" id="sx-ai-folder"><summary><span class="sx-ai-row-title">Файлы проекта</span><span class="sx-ai-row-value"></span></summary>
<ul></ul><p role="status"></p>
</details>
<details class="sx-ai-side-section" id="sx-ai-ctx"><summary><span class="sx-ai-row-title">Контекст</span><span class="sx-ai-row-value"></span></summary><div class="sx-ai-context-body"><p class="sx-ai-note">Появится после первого ответа в чате.</p></div></details>
<details class="sx-ai-side-section" id="sx-ai-usage"><summary><span class="sx-ai-row-title">Расход</span><span class="sx-ai-row-value"></span></summary><div class="sx-ai-usage-body"><p class="sx-ai-note">Загружаю…</p></div></details>
<details class="sx-ai-side-section" id="sx-ai-project"><summary><span class="sx-ai-row-title">Память и навыки сайта</span><span class="sx-ai-row-value"></span></summary>
<label>Особенности сайта<textarea class="form-control" id="sx-ai-rules" maxlength="12000" rows="5"></textarea></label>
<label>Навыки сайта<textarea class="form-control" id="sx-ai-skills" maxlength="12000" rows="5" placeholder="## Название навыка&#10;Когда и как его применять"></textarea></label>
<button class="sx-button sx-button--secondary" type="button" id="sx-ai-saveRules" hidden>Сохранить для сайта</button><p id="sx-ai-settingsStatus" role="status"></p>
<details><summary>Общие правила и навыки SkeekS</summary><pre id="sx-ai-global"></pre></details>
</details>
</div>
</main>
</dialog>
