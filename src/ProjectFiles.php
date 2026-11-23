<?php

namespace skeeks\cms\ai;

use skeeks\cms\mcp\tools\CallbackTool;
use Yii;
use yii\db\Query;
use yii\helpers\FileHelper;
use yii\web\BadRequestHttpException;
use yii\web\ConflictHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\NotFoundHttpException;

/** Immutable blobs; atomic replacement of the index publishes a whole batch. */
final class ProjectFiles
{
    public static function tools(): array
    {
        $path = ['type'=>'string', 'description'=>'Относительный путь файла проекта, например design/main.css'];
        $object = static function (array $properties, array $required) {
            return ['type'=>'object','properties'=>(object)$properties,'required'=>$required,'additionalProperties'=>false];
        };
        $file = $object([
            'path'=>$path,
            'revision'=>['type'=>'string','description'=>'Для замены укажи точную текущую revision из списка. Для нового файла оставь пустой.'],
            'text'=>['type'=>'string','description'=>'Полное новое содержимое текстового файла'],
            'attachment_id'=>['type'=>'integer','description'=>'Чтобы сохранить исходный файл из личных вложений без преобразования, укажи его ID вместо text'],
        ], ['path']);
        $definitions = [
            ['list','Список общих файлов проекта сайта: пути и текущие версии. Одинаков для всех чатов с правом чтения.', $object(['offset'=>['type'=>'integer']],[]),'listing'],
            ['read','Чтение текстового макета, стилей или другого общего файла проекта по пути; offset в символах.', $object(['path'=>$path,'offset'=>['type'=>'integer']],['path']),'read'],
            ['save','Сохранить макет, CSS и другие файлы в постоянную общую папку проекта для других чатов. Пакет изменений сохраняется вместе. Для исходных вложений используй attachment_id.', $object(['files'=>['type'=>'array','items'=>$file]],['files']),'save'],
        ];
        $tools = [];
        foreach ($definitions as [$name,$description,$schema,$method]) {
            $tools[] = new CallbackTool(['name'=>'cms_ai_project_files_'.$name,'description'=>$description,
                'requiredScope'=>$name==='save'?'cms.storage.write':'cms.storage.read',
                'inputSchema'=>$schema,'callback'=>[self::class,$method]]);
        }
        return $tools;
    }

    public static function allowed(bool $write = false): bool
    {
        $site = Yii::$app->skeeks->site;
        $user = Yii::$app->user;
        $params = ['model'=>$site->rootCmsTree];
        $sameSite = !$user->isGuest && ((int)$user->identity->cms_site_id === (int)$site->id
            || $user->can(\skeeks\cms\rbac\CmsManager::ROLE_ADMIN,[],false));
        return $site->id && $sameSite && $user->can('cms/admin-tree/index',$params,false)
            && (!$write || $user->can('cms/admin-tree/update',$params,false));
    }

    private static function root(bool $write = false): string
    {
        if (!self::allowed($write)) {
            throw new ForbiddenHttpException('Недостаточно прав на файлы этого сайта.');
        }
        return Yii::getAlias('@root/console/runtime/cms-ai/projects/').(int)Yii::$app->skeeks->site->id;
    }

    private static function index(string $root): array
    {
        return is_file($root.'/index.json') ? json_decode(file_get_contents($root.'/index.json'),true,64,JSON_THROW_ON_ERROR) : [];
    }

    private static function path($value): string
    {
        if (!is_string($value) || strlen($value)>255 || !preg_match('~^[\pL\pN_-][\pL\pN_. -]*(?:/[\pL\pN_-][\pL\pN_. -]*)*$~uD',$value)) {
            throw new BadRequestHttpException('Некорректный путь файла проекта.');
        }
        return $value;
    }

    public static function listing(array $args): array
    {
        $index = self::index(self::root());
        ksort($index,SORT_STRING);
        $items = [];
        $offset = max(0,(int)($args['offset'] ?? 0));
        foreach (array_slice($index,$offset,10,true) as $path=>$meta) {
            $items[] = ['path'=>(string)$path]+$meta;
        }
        return ['files'=>$items,'total'=>count($index),'next_offset'=>$offset+count($items)<count($index)?$offset+count($items):null];
    }

    public static function source(string $path): array
    {
        $root = self::root();
        $meta = self::index($root)[self::path($path)] ?? null;
        if (!$meta) { throw new NotFoundHttpException('Файл проекта не найден.'); }
        return [$root.'/blobs/'.$meta['revision'],$meta];
    }

    public static function read(array $args): array
    {
        [$file,$meta] = self::source($args['path']);
        $data = file_get_contents($file);
        if (!mb_check_encoding($data,'UTF-8') || strpos($data,"\0")!==false) {
            $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($data);
            if (in_array($mime,['image/png','image/jpeg','image/webp'],true)) {
                return ['name'=>basename($args['path']),'base64'=>base64_encode($data),'kind'=>'project_image'];
            }
            throw new BadRequestHttpException('Двоичный файл доступен для скачивания.');
        }
        $offset = max(0,(int)($args['offset'] ?? 0));
        $text = mb_substr($data,$offset,1000);
        $next = $offset+mb_strlen($text);
        return ['path'=>$args['path'],'revision'=>$meta['revision'],'text'=>$text,'next_offset'=>$next<mb_strlen($data)?$next:null];
    }

    private static function bytes(array $file): string
    {
        if (array_key_exists('text',$file) === array_key_exists('attachment_id',$file)) {
            throw new BadRequestHttpException('Нужен текст или вложение.');
        }
        if (isset($file['attachment_id'])) {
            $chat = (int)Yii::$app->request->headers->get('X-Skeeks-AI-Chat');
            $data = (new Query())->from(['a'=>'{{%cms_ai_attachment}}'])
                ->innerJoin(['m'=>'{{%cms_ai_chat_message}}'],'m.id=a.message_id')
                ->innerJoin(['c'=>'{{%cms_ai_chat}}'],'c.id=m.chat_id')
                ->where(['a.id'=>$file['attachment_id'],'c.id'=>$chat,'c.site_id'=>Yii::$app->skeeks->site->id,'c.owner_id'=>Yii::$app->user->id])
                ->select('a.content')->scalar();
            if ($data===false) { throw new NotFoundHttpException('Вложение не найдено в вашем чате.'); }
            return $data;
        }
        if (!is_string($file['text'] ?? null) || strlen($file['text'])>4194304) { throw new BadRequestHttpException('Нужен текст файла.'); }
        return $file['text'];
    }

    private static function atomicWrite(string $target,string $data): void
    {
        $temp = tempnam(dirname($target),'.write-');
        if (!$temp) { throw new \RuntimeException('Не удалось создать временный файл.'); }
        try {
            if (file_put_contents($temp,$data)!==strlen($data) || !rename($temp,$target)) {
                throw new \RuntimeException('Файл проекта не сохранён.');
            }
        } finally {
            if (is_file($temp)) { unlink($temp); }
        }
    }

    public static function save(array $args): array
    {
        $root = self::root(true);
        $files = $args['files'] ?? [];
        if (!is_array($files) || !$files || count($files)>16) { throw new BadRequestHttpException('Укажите от 1 до 16 файлов.'); }
        FileHelper::createDirectory($root.'/blobs',0700);
        $lock = fopen($root.'/.lock','c');
        if (!$lock) { throw new \RuntimeException('Папка проекта недоступна.'); }
        try {
            if (!flock($lock,LOCK_EX)) { throw new \RuntimeException('Не удалось заблокировать папку проекта.'); }
            $index = self::index($root);
            $changed = [];
            $blobs = [];
            foreach ($files as $file) {
                $path = self::path($file['path'] ?? null);
                if (isset($changed[$path])) { throw new BadRequestHttpException('Путь повторяется.'); }
                $data = self::bytes($file);
                $revision = hash('sha256',$data);
                $current = $index[$path]['revision'] ?? '';
                if ($current!==$revision && $current!==($file['revision'] ?? '')) {
                    throw new ConflictHttpException('Версия файла изменилась: '.$path);
                }
                foreach (array_keys($index) as $existing) {
                    if (str_starts_with((string)$existing,$path.'/') || str_starts_with($path,$existing.'/')) {
                        throw new ConflictHttpException('Путь файла занят каталогом или родительским файлом.');
                    }
                }
                if (!is_file($root.'/blobs/'.$revision)) { $blobs[$revision] = $data; }
                $index[$path] = ['revision'=>$revision,'size'=>strlen($data)];
                $changed[$path] = $revision;
            }
            foreach ($blobs as $revision=>$data) {
                self::atomicWrite($root.'/blobs/'.$revision,$data);
            }
            self::atomicWrite($root.'/index.json',json_encode((object)$index,JSON_THROW_ON_ERROR));
            return ['saved'=>array_keys($changed)];
        } finally {
            fclose($lock);
        }
    }
}
