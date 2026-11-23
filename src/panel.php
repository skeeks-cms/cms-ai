<?php
use skeeks\cms\widgets\formInputs\attachments\AttachmentsInputWidget;
use skeeks\cms\widgets\formInputs\richText\RichTextInputWidget;
?>
<dialog class="sx-ai-panel" data-project-write="<?= (int)\skeeks\cms\ai\ProjectFiles::allowed(true) ?>" aria-label="SkeekS AI">
<header><button type="button" class="sx-button sx-button--secondary" id="sx-ai-toggleChats" aria-expanded="false" aria-controls="sx-ai-sidebar">Чаты</button><strong>SkeekS AI</strong><button type="button" class="sx-button sx-button--secondary" data-sx-ai-close>Закрыть</button></header>
<main>
<nav id="sx-ai-sidebar" aria-label="Мои чаты">
<label id="sx-ai-engineLabel" hidden>Движок нового чата<select class="form-control" id="sx-ai-engine"></select></label>
<button class="sx-button sx-button--secondary" type="button" id="sx-ai-newChat">+ Новый чат</button>
<strong>Мои чаты</strong>
<input class="form-control" type="search" id="sx-ai-search" maxlength="200" placeholder="Поиск по чатам" aria-label="Поиск по названиям и сообщениям">
<div id="sx-ai-listStatus" role="status"></div>
<div id="sx-ai-chats"></div>
<div class="sx-ai-project-tools">
<label id="sx-ai-groupLabel" hidden>Проект текущего чата<select class="form-control" id="sx-ai-group"></select></label>
<details id="sx-ai-folder"><summary>Файлы проекта</summary>
<ul></ul><p role="status"></p>
</details><details id="sx-ai-project"><summary>Память и навыки сайта</summary>
<label>Особенности сайта<textarea class="form-control" id="sx-ai-rules" maxlength="12000" rows="5"></textarea></label>
<label>Навыки сайта<textarea class="form-control" id="sx-ai-skills" maxlength="12000" rows="5" placeholder="## Название навыка&#10;Когда и как его применять"></textarea></label>
<button class="sx-button sx-button--secondary" type="button" id="sx-ai-saveRules" hidden>Сохранить для сайта</button><p id="sx-ai-settingsStatus" role="status"></p>
<details><summary>Общие правила и навыки SkeekS</summary><pre id="sx-ai-global"></pre></details></details></div></nav>
<section class="sx-ai-conversation" aria-label="Переписка"><div id="sx-ai-scroll"><h2 id="sx-ai-title"></h2><p id="sx-ai-context"></p><section id="sx-ai-messages" aria-live="polite"></section><aside hidden id="sx-ai-preview"><strong>Действие в CRM</strong><pre></pre><div class="sx-ai-actions"><button type="button" class="sx-button sx-button--primary" id="sx-ai-confirm">Подтвердить</button><button type="button" class="sx-button sx-button--secondary" id="sx-ai-reject">Отклонить</button></div></aside><details id="sx-ai-activity" hidden><summary>Ход выполнения</summary><ol></ol></details></div><div class="sx-ai-composer"><div class="sx-ai-jobline"><p id="sx-ai-job" role="status"></p><button type="button" class="sx-button sx-button--secondary sx-button--sm" id="sx-ai-stop" hidden>Остановить</button></div><form>
<?= RichTextInputWidget::widget([
    'name' => 'message', 'options' => ['id' => 'sx-ai-message'],
    'preset' => 'basic', 'tools' => [], 'paragraph' => 'div', 'minHeight' => 72,
    'placeholder' => 'Напишите сообщение…', 'attachLabel' => 'Прикрепить файлом',
    'uploadUrl' => null,
]) ?>
<?= AttachmentsInputWidget::widget(['name' => 'uploads', 'maxSize' => 4194304, 'options' => ['id' => 'sx-ai-files']]) ?>
<div class="sx-comment-actions">
<button type="submit" class="sx-button sx-button--primary">Отправить</button>
<?= AttachmentsInputWidget::button(['for' => 'sx-ai-files']) ?>
</div>
<small>До 4 файлов, вместе до 4 МБ</small>
</form><p id="sx-ai-status" role="status"></p></div></section></main>
</dialog>
