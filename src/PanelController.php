<?php

namespace skeeks\cms\ai;

use skeeks\cms\ai\service\ChatApi;
use skeeks\cms\services\TemporaryUploads;
use Yii;
use yii\web\BadRequestHttpException;
use yii\web\Controller;
use yii\web\ForbiddenHttpException;
use yii\web\HttpException;
use yii\web\Response;

/**
 * Panel endpoints of the employee's browser session. Chats, runs and events are
 * operations of SkeekS AI API v1 (ChatApi); the panel never waits for the engine.
 */
final class PanelController extends Controller
{
    public function beforeAction($action)
    {
        Yii::$app->response->headers->set('Cache-Control', 'no-store');
        if (Yii::$app->user->isGuest) {
            throw new ForbiddenHttpException();
        }
        if (!parent::beforeAction($action)) {
            return false;
        }
        // Event polling and file reads must not serialize behind the PHP session lock.
        Yii::$app->session->close();
        return true;
    }

    public function actionProjectFiles(int $offset = 0)
    {
        Yii::$app->response->format = Response::FORMAT_JSON;
        return ProjectFiles::listing(['offset'=>$offset]);
    }

    public function actionProjectSave()
    {
        if (!Yii::$app->request->isPost) { throw new HttpException(405); }
        Yii::$app->response->format = Response::FORMAT_JSON;
        $args = json_decode(Yii::$app->request->rawBody,true);
        if (!is_array($args)) { throw new BadRequestHttpException(); }
        return ProjectFiles::save($args);
    }

    /** File manager: all files and folders of the project. */
    public function actionProjectTree()
    {
        Yii::$app->response->format = Response::FORMAT_JSON;
        return ProjectFiles::all();
    }

    /** File manager: an uploaded file (multipart "file", "path", "revision" of the replaced file or empty). */
    public function actionProjectUpload()
    {
        if (!Yii::$app->request->isPost) { throw new HttpException(405); }
        Yii::$app->response->format = Response::FORMAT_JSON;
        $file = \yii\web\UploadedFile::getInstanceByName('file');
        if (!$file || $file->error !== UPLOAD_ERR_OK) { throw new BadRequestHttpException('Файл не получен.'); }
        if ($file->size > \skeeks\cms\ai\service\ProjectFileStore::MAX_SIZE) { throw new BadRequestHttpException('Файл больше 4 МБ.'); }
        $request = Yii::$app->request;
        return ProjectFiles::upload((string)$request->post('path'), (string)$request->post('revision', ''), (string)file_get_contents($file->tempName));
    }

    /** File manager: {op: folder|delete|move, …}. */
    public function actionProjectChange()
    {
        if (!Yii::$app->request->isPost) { throw new HttpException(405); }
        Yii::$app->response->format = Response::FORMAT_JSON;
        $args = json_decode(Yii::$app->request->rawBody,true);
        if (!is_array($args)) { throw new BadRequestHttpException(); }
        switch ($args['op'] ?? '') {
            case 'folder': return ProjectFiles::folder((string)($args['path'] ?? ''));
            case 'delete': return ProjectFiles::delete(is_array($args['items'] ?? null) ? $args['items'] : []);
            case 'move': return ProjectFiles::move((string)($args['from'] ?? ''), (string)($args['to'] ?? ''));
        }
        throw new BadRequestHttpException('Неизвестное действие.');
    }

    public function actionProjectDownload(string $path)
    {
        [$content] = ProjectFiles::source($path);
        Yii::$app->response->headers->set('X-Content-Type-Options','nosniff');
        return Yii::$app->response->sendContentAsFile($content,basename($path),['mimeType'=>'application/octet-stream','inline'=>false]);
    }

    public function actionSidebar(string $q = '')
    {
        Yii::$app->response->format = Response::FORMAT_JSON;
        $scope = ['owner_id'=>Yii::$app->user->id, 'site_id'=>Yii::$app->skeeks->site->id];
        $request = Yii::$app->request;
        $projects = [];
        if (Yii::$app->user->can('cms/admin-company')) {
            $projects = \skeeks\cms\models\CmsProject::find()->forManager()
                ->select(['cms_project.id','cms_project.name'])->distinct()->orderBy('cms_project.name')->asArray()->all();
        }
        $names = array_column($projects,'name','id');
        if ($request->isPost) {
            $data = json_decode($request->rawBody,true);
            $where = $scope + ['id'=>(int)($data['id'] ?? 0)];
            if (!(new \yii\db\Query())->from('{{%cms_ai_chat}}')->where($where)->exists()) {
                throw new \yii\web\NotFoundHttpException();
            }
            if (isset($data['pin']) && is_bool($data['pin'])) {
                $change = ['is_pinned'=>(int)$data['pin']];
            } elseif (is_array($data) && array_key_exists('project',$data)) {
                $id = $data['project'];
                if ($id !== null && (!is_int($id) || !isset($names[$id]))) { throw new ForbiddenHttpException(); }
                $change = ['project_id'=>$id];
            } else { throw new BadRequestHttpException(); }
            Yii::$app->db->createCommand()->update('{{%cms_ai_chat}}',$change,$where)->execute();
        } elseif (!$request->isGet) { throw new \yii\web\MethodNotAllowedHttpException(); }

        $query = (new \yii\db\Query())->from(['c'=>'{{%cms_ai_chat}}'])->where($scope);
        $q = trim($q);
        if (mb_strlen($q)>200) { throw new BadRequestHttpException(); }
        if ($q !== '') {
            $matches = (new \yii\db\Query())->select('m.id')->from(['m'=>'{{%cms_ai_chat_message}}'])
                ->where('m.chat_id = c.id')->andWhere(['like','m.text',$q]);
            $query->andWhere(['or',['like','c.title',$q],['exists',$matches]]);
        }
        // State for the list: a run in progress or an action waiting for confirmation.
        $working = (new \yii\db\Query())->from(['r'=>ChatApi::RUN])->where('r.chat_id = c.id')->andWhere(['r.status'=>ChatApi::ACTIVE]);
        $rows = $query->select(['c.id','c.title','c.project_id','c.is_pinned',
                'working'=>new \yii\db\Expression('EXISTS(' . $working->select('r.id')->createCommand()->rawSql . ')'),
                'waiting'=>new \yii\db\Expression('c.pending IS NOT NULL')])
            ->orderBy(['c.updated_at'=>SORT_DESC,'c.id'=>SORT_DESC])->all();
        foreach ($rows as &$row) {
            if (!isset($names[$row['project_id']])) { $row['project_id'] = null; }
            $row['working'] = (bool)$row['working'];
            $row['waiting'] = (bool)$row['waiting'];
        }
        return ['chats'=>$rows,'projects'=>$projects];
    }

    public function actionApi(string $op)
    {
        $request = Yii::$app->request;
        $response = Yii::$app->response;
        $get = ['history', 'events', 'file', 'settings', 'usage'];
        $post = ['message', 'confirm', 'reject', 'cancel', 'settings', 'rename', 'delete', 'steer'];
        if (!($request->isGet && in_array($op, $get, true)) && !($request->isPost && in_array($op, $post, true))) {
            throw new HttpException(405);
        }
        $data = [];
        if ($request->isPost) {
            $data = json_decode($request->rawBody, true);
            if (!is_array($data)) {
                throw new BadRequestHttpException();
            }
        }
        if ($op === 'file') {
            $file = ChatApi::file((int)$request->get('chat'), (int)$request->get('id'));
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $image = preg_match('/^preview-[0-9]+-(phone|desktop)\.jpg$/D', $file['name']);
            return $response->sendContentAsFile($file['content'], $file['name'], [
                'mimeType' => $image ? 'image/jpeg' : 'application/octet-stream', 'inline' => (bool)$image,
            ]);
        }
        $response->format = Response::FORMAT_JSON;
        try {
            switch ($op) {
                case 'history':
                    $chat = $request->get('chat');
                    return ChatApi::chat($chat === null || $chat === '' ? null : (int)$chat, (int)$request->get('company') ?: null);
                case 'usage':
                    return ChatApi::usage((int)$request->get('chat') ?: null);
                case 'events':
                    return ChatApi::events((int)$request->get('chat'), (int)$request->get('after'));
                case 'message':
                    $files = $this->attachments($data['uploads'] ?? []);
                    unset($data['uploads']);
                    return ChatApi::send($data, $files);
                case 'confirm':
                    return ChatApi::confirm((int)($data['chatId'] ?? 0), (string)($data['id'] ?? ''));
                case 'reject':
                    ChatApi::reject((int)($data['chatId'] ?? 0), (string)($data['id'] ?? ''));
                    return ['ok' => true];
                case 'cancel':
                    return ChatApi::cancel((int)($data['chatId'] ?? 0), (int)($data['runId'] ?? 0));
                case 'steer':
                    return ChatApi::steer((int)($data['chatId'] ?? 0), (int)($data['runId'] ?? 0), (string)($data['message'] ?? ''));
                case 'rename':
                    ChatApi::rename((int)($data['chatId'] ?? 0), (string)($data['title'] ?? ''));
                    return ['ok' => true];
                case 'delete':
                    ChatApi::delete((int)($data['chatId'] ?? 0));
                    return ['ok' => true];
                case 'settings':
                    return $this->settings($request->isPost ? ['op' => 'saveSettings'] + $data : ['op' => 'settings']);
            }
        } catch (HttpException $e) {
            $response->statusCode = $e->statusCode;
            return ['error' => $e->getMessage()];
        }
        throw new HttpException(405);
    }

    private function settings(array $data): array
    {
        $project = ProjectKnowledge::settings((int)Yii::$app->skeeks->site->id, $data);
        $shared = \skeeks\cms\ai\service\ProjectRulesStore::shared();
        return $project + ['globalRules' => $shared['rules'], 'globalSkills' => $shared['skills']];
    }

    /** @return array [['name' => string, 'bytes' => string]] */
    private function attachments($tokens): array
    {
        if (!is_array($tokens) || count($tokens) > 4) {
            throw new BadRequestHttpException('Можно приложить до четырёх файлов.');
        }
        $files = [];
        $total = 0;
        foreach ($tokens as $token) {
            $path = is_string($token) ? TemporaryUploads::path($token) : null;
            if (!$path || ($total += filesize($path)) > 4194304) {
                throw new BadRequestHttpException('Проверьте вложения. Общий размер файлов ограничен 4 МБ.');
            }
            $files[] = ['name' => TemporaryUploads::name($token), 'bytes' => (string)file_get_contents($path)];
        }
        return $files;
    }
}
