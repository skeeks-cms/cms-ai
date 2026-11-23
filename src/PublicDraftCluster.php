<?php
namespace skeeks\cms\ai;

use skeeks\cms\components\storage\ClusterLocal;
use skeeks\sx\File;

/** Public site assets may originate from a private temporary upload (0600). */
final class PublicDraftCluster extends ClusterLocal
{
    public function upload(File $tmpFile)
    {
        $relative = parent::upload($tmpFile);
        if (!chmod($this->rootBasePath . DIRECTORY_SEPARATOR . $relative, 0644)) {
            throw new \RuntimeException('Не удалось открыть для чтения готовый файл сайта.');
        }
        return $relative;
    }
}
