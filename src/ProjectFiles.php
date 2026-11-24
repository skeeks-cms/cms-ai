<?php

namespace skeeks\cms\ai;

use skeeks\cms\ai\service\ProjectFileStore;
use skeeks\cms\mcp\tools\CallbackTool;
use Yii;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;

/** Shared project files of the site: rights and agent tools here, storage in the central service (ProjectFileStore). */
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

    /** Project of the current site in the central service (the pilot keys projects by site). */
    private static function site(bool $write = false): int
    {
        if (!self::allowed($write)) {
            throw new ForbiddenHttpException('Недостаточно прав на файлы этого сайта.');
        }
        return (int)Yii::$app->skeeks->site->id;
    }

    private static function user(): ?int
    {
        return Yii::$app->user->isGuest ? null : (int)Yii::$app->user->id;
    }

    public static function listing(array $args): array
    {
        return ProjectFileStore::files(self::site(), max(0,(int)($args['offset'] ?? 0)));
    }

    /** All files and folders, for the file manager. */
    public static function all(): array
    {
        return ['items'=>ProjectFileStore::all(self::site())];
    }

    /** [content, meta] of a file. */
    public static function source(string $path): array
    {
        return ProjectFileStore::get(self::site(), $path);
    }

    public static function read(array $args): array
    {
        [$data,$meta] = self::source((string)($args['path'] ?? ''));
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

    public static function save(array $args): array
    {
        $site = self::site(true);
        $files = $args['files'] ?? null;
        if (!is_array($files)) { throw new BadRequestHttpException('Укажите от 1 до 16 файлов.'); }
        $prepared = [];
        foreach ($files as $file) {
            if (!is_array($file) || array_key_exists('text',$file) === array_key_exists('attachment_id',$file)) {
                throw new BadRequestHttpException('Нужен текст или вложение.');
            }
            if (isset($file['attachment_id'])) {
                $chat = (int)Yii::$app->request->headers->get('X-Skeeks-AI-Chat');
                $data = ProjectFileStore::attachment($site,(int)self::user(),$chat,(int)$file['attachment_id']);
            } elseif (is_string($file['text'] ?? null)) {
                $data = $file['text'];
            } else {
                throw new BadRequestHttpException('Нужен текст файла.');
            }
            $prepared[] = ['path'=>$file['path'] ?? null,'revision'=>(string)($file['revision'] ?? ''),'data'=>$data];
        }
        return ['saved'=>ProjectFileStore::save($site,self::user(),$prepared)['saved']];
    }

    /** A file uploaded in the file manager; $revision is the replaced file's revision or '' for a new one. */
    public static function upload(string $path, string $revision, string $data): array
    {
        return ProjectFileStore::save(self::site(true),self::user(),[['path'=>$path,'revision'=>$revision,'data'=>$data]]);
    }

    public static function folder(string $path): array
    {
        return ProjectFileStore::folder(self::site(true),self::user(),$path);
    }

    public static function delete(array $items): array
    {
        return ProjectFileStore::delete(self::site(true),self::user(),$items);
    }

    public static function move(string $from, string $to): array
    {
        return ProjectFileStore::move(self::site(true),self::user(),$from,$to);
    }
}
