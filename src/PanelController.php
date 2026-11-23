<?php

namespace skeeks\cms\ai;

use skeeks\cms\services\TemporaryUploads;
use Yii;
use yii\web\BadRequestHttpException;
use yii\web\Controller;
use yii\web\ForbiddenHttpException;
use yii\web\HttpException;
use yii\web\Response;

final class PanelController extends Controller
{
    public $serviceUrl;

    public function beforeAction($action)
    {
        Yii::$app->response->headers->set('Cache-Control', 'no-store');
        if (Yii::$app->user->isGuest) {
            throw new ForbiddenHttpException();
        }
        return parent::beforeAction($action);
    }

    private function sessionKey(string $tab): string
    {
        if (!preg_match('/^[a-f0-9]{32}$/D', $tab)) {
            throw new BadRequestHttpException();
        }
        return 'skeeks-ai/' . hash('sha256', Yii::$app->session->id) . '/' . Yii::$app->user->id . '/' . Yii::$app->skeeks->site->id . '/' . $tab;
    }

    private function requestService(string $path, string $tab, ?array $data = null): array
    {
        $session = Yii::$app->session;
        $sid = Yii::$app->cache->get($this->sessionKey($tab));
        $session->close();
        $key = trim((string)@file_get_contents(Yii::getAlias('@runtime/skeeks-ai-bridge.key')));
        if ($key === '') {
            throw new HttpException(503, 'Подключение SkeekS AI не настроено.');
        }
        $headers = [];
        $curl = curl_init(rtrim($this->serviceUrl, '/') . $path);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 240,
            CURLOPT_HTTPHEADER => ['X-Skeeks-AI-Bridge: ' . $key, 'Content-Type: application/json'],
            CURLOPT_COOKIE => 'skeeks_ai_pilot_' . $tab . '=' . $sid,
            CURLOPT_HEADERFUNCTION => static function ($curl, $line) use (&$headers) {
                if (strpos($line, ':') !== false) {
                    [$name, $value] = explode(':', $line, 2);
                    $headers[strtolower($name)] = trim($value);
                }
                return strlen($line);
            },
        ]);
        if ($data !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode((object)$data, JSON_THROW_ON_ERROR));
        }
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            throw new HttpException(502, 'Нет ответа от SkeekS AI.');
        }
        return [$status, $headers, $body];
    }

    public function actionStart(string $tab, $company = '')
    {
        $key = $this->sessionKey($tab);
        [$status, $headers] = $this->requestService('/panel/' . $tab . '/start?company=' . (int)$company, $tab);
        $location = $headers['location'] ?? '';
        if ($status !== 302 || !str_starts_with($location, Yii::$app->request->hostInfo . '/')
            || !preg_match('/^skeeks_ai_pilot_' . $tab . '=([A-Za-z0-9_-]+);/', $headers['set-cookie'] ?? '', $m)) {
            throw new HttpException(502, 'Не удалось начать авторизацию.');
        }
        Yii::$app->cache->set($key, $m[1], 86400);
        return $this->redirect($location);
    }

    public function actionCallback(string $state, string $code)
    {
        $tab = explode('.', $state)[0];
        [$status, $headers, $body] = $this->requestService('/callback?' . http_build_query(compact('state', 'code')), $tab);
        if ($status !== 302 || ($headers['location'] ?? '') !== '/panel/' . $tab . '/') {
            $error = json_decode($body, true)['error'] ?? '';
            if (preg_match('/HTTP (\d{3})/', $error, $match)) {
                throw new HttpException(502, 'CRM отклонила авторизацию (HTTP ' . $match[1] . ').');
            }
            throw new ForbiddenHttpException('Не удалось подтвердить вход в SkeekS AI.');
        }
        Yii::$app->response->headers->set('Referrer-Policy', 'no-referrer');
        return '<script>parent.postMessage({tab:' . json_encode($tab) . '},location.origin)</script>';
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

    public function actionProjectDownload(string $path)
    {
        [$file] = ProjectFiles::source($path);
        Yii::$app->response->headers->set('X-Content-Type-Options','nosniff');
        return Yii::$app->response->sendFile($file,basename($path),['mimeType'=>'application/octet-stream','inline'=>false]);
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
        $rows = $query->select(['c.id','c.title','c.project_id','c.is_pinned'])
            ->orderBy(['c.updated_at'=>SORT_DESC,'c.id'=>SORT_DESC])->all();
        foreach ($rows as &$row) {
            if (!isset($names[$row['project_id']])) { $row['project_id'] = null; }
        }
        return ['chats'=>$rows,'projects'=>$projects];
    }

    public function actionApi(string $tab, string $op)
    {
        $request = Yii::$app->request;
        $post = $request->isPost;
        if (!(($post && in_array($op, ['message','confirm','select','new','settings'], true))
            || ($request->isGet && in_array($op, ['history','settings','progress','file'], true)))) {
            throw new HttpException(405);
        }
        $data = $post ? json_decode($request->rawBody, true) : null;
        if ($post && !is_array($data)) {
            throw new BadRequestHttpException();
        }
        if ($op === 'message') {
            $tokens = $data['uploads'] ?? [];
            unset($data['uploads']);
            $data['files'] = $this->attachments($tokens);
        }
        $path = '/panel/' . $tab . '/' . $op;
        if ($op === 'file') {
            $path .= '?' . http_build_query(['chat' => (int)$request->get('chat'), 'id' => (int)$request->get('id')]);
        }
        [$status, $headers, $body] = $this->requestService($path, $tab, $data);
        $response = Yii::$app->response;
        if ($status === 302) {
            $response->format = Response::FORMAT_JSON;
            $response->statusCode = 401;
            return ['error' => 'Сессия завершилась. Откройте чат заново.'];
        }
        $response->statusCode = $status;
        $response->format = Response::FORMAT_RAW;
        $response->headers->set('Content-Type', $headers['content-type'] ?? 'application/json');
        if ($op === 'file' && isset($headers['content-disposition'])) {
            $response->headers->set('Content-Disposition', $headers['content-disposition']);
        }
        return $body;
    }

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
            $files[] = ['name' => TemporaryUploads::name($token), 'base64' => base64_encode(file_get_contents($path))];
        }
        return $files;
    }
}
