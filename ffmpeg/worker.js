/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { CORE_URL, FFMessageType } from "./const.js";
import {
ERROR_UNKNOWN_MESSAGE_TYPE,
ERROR_NOT_LOADED,
ERROR_IMPORT_FAILURE,
} from "./errors.js";

let ffmpeg;

/* ============================================================
FFmpeg Core 로드

* module Worker 전용
* importScripts() 사용하지 않음
* @ffmpeg/core 0.12.10 ESM 사용
* ffmpeg-core.worker.js 사용하지 않음
  ============================================================ */

const load = async ({
coreURL: _coreURL,
wasmURL: _wasmURL,
} = {}) => {
const first = !ffmpeg;

```
try {
    const coreURL = _coreURL || CORE_URL;

    const wasmURL =
        _wasmURL ||
        coreURL.replace(/\.js$/i, ".wasm");

    /* --------------------------------------------------------
       ESM 방식으로 ffmpeg-core.js 로드
       -------------------------------------------------------- */

    const module = await import(
        /* webpackIgnore: true */
        /* @vite-ignore */
        coreURL
    );

    const createFFmpegCore = module.default;

    if (!createFFmpegCore) {
        throw ERROR_IMPORT_FAILURE;
    }

    /* --------------------------------------------------------
       WASM 위치 전달
       -------------------------------------------------------- */

    const config = {
        wasmURL,
    };

    /*
     * FFmpeg core 내부에서 locateFile()이
     * WASM 위치를 정확하게 찾을 수 있도록
     * core URL 뒤에 설정값을 전달한다.
     */
    const encodedConfig = btoa(
        JSON.stringify(config)
    );

    ffmpeg = await createFFmpegCore({
        mainScriptUrlOrBlob:
            `${coreURL}#${encodedConfig}`,
    });

    /* --------------------------------------------------------
       로그
       -------------------------------------------------------- */

    ffmpeg.setLogger((data) => {
        self.postMessage({
            type: FFMessageType.LOG,
            data,
        });
    });

    /* --------------------------------------------------------
       진행률
       -------------------------------------------------------- */

    ffmpeg.setProgress((data) => {
        self.postMessage({
            type: FFMessageType.PROGRESS,
            data,
        });
    });

    return first;

} catch (error) {

    console.error(
        "[FFmpeg Worker] Core load error:",
        error
    );

    throw error;
}
```

};

/* ============================================================
EXEC
============================================================ */

const exec = ({
args,
timeout = -1,
}) => {

```
ffmpeg.setTimeout(timeout);

ffmpeg.exec(...args);

const ret = ffmpeg.ret;

ffmpeg.reset();

return ret;
```

};

/* ============================================================
FILE SYSTEM
============================================================ */

const writeFile = ({
path,
data,
}) => {

```
ffmpeg.FS.writeFile(
    path,
    data
);

return true;
```

};

const readFile = ({
path,
encoding,
}) => {

```
return ffmpeg.FS.readFile(
    path,
    { encoding }
);
```

};

const deleteFile = ({
path,
}) => {

```
ffmpeg.FS.unlink(path);

return true;
```

};

const rename = ({
oldPath,
newPath,
}) => {

```
ffmpeg.FS.rename(
    oldPath,
    newPath
);

return true;
```

};

const createDir = ({
path,
}) => {

```
ffmpeg.FS.mkdir(path);

return true;
```

};

const listDir = ({
path,
}) => {

```
const names =
    ffmpeg.FS.readdir(path);

const nodes = [];

for (const name of names) {

    const stat =
        ffmpeg.FS.stat(
            `${path}/${name}`
        );

    const isDir =
        ffmpeg.FS.isDir(stat.mode);

    nodes.push({
        name,
        isDir,
    });
}

return nodes;
```

};

const deleteDir = ({
path,
}) => {

```
ffmpeg.FS.rmdir(path);

return true;
```

};

/* ============================================================
MOUNT
============================================================ */

const mount = ({
fsType,
options,
mountPoint,
}) => {

```
const str = fsType;

const fs =
    ffmpeg.FS.filesystems[str];

if (!fs) {
    return false;
}

ffmpeg.FS.mount(
    fs,
    options,
    mountPoint
);

return true;
```

};

const unmount = ({
mountPoint,
}) => {

```
ffmpeg.FS.unmount(
    mountPoint
);

return true;
```

};

/* ============================================================
MESSAGE HANDLER
============================================================ */

self.onmessage = async ({
data: {
id,
type,
data: _data,
},
}) => {

```
const trans = [];

let data;

try {

    /* ------------------------------------------------------
       LOAD 이외의 명령은 FFmpeg가 먼저 로드되어야 한다.
       ------------------------------------------------------ */

    if (
        type !== FFMessageType.LOAD &&
        !ffmpeg
    ) {
        throw ERROR_NOT_LOADED;
    }


    switch (type) {

        /* ==================================================
           LOAD
           ================================================== */

        case FFMessageType.LOAD:

            data =
                await load(_data);

            break;


        /* ==================================================
           EXEC
           ================================================== */

        case FFMessageType.EXEC:

            data =
                exec(_data);

            break;


        /* ==================================================
           WRITE FILE
           ================================================== */

        case FFMessageType.WRITE_FILE:

            data =
                writeFile(_data);

            break;


        /* ==================================================
           READ FILE
           ================================================== */

        case FFMessageType.READ_FILE:

            data =
                readFile(_data);

            break;


        /* ==================================================
           DELETE FILE
           ================================================== */

        case FFMessageType.DELETE_FILE:

            data =
                deleteFile(_data);

            break;


        /* ==================================================
           RENAME
           ================================================== */

        case FFMessageType.RENAME:

            data =
                rename(_data);

            break;


        /* ==================================================
           CREATE DIR
           ================================================== */

        case FFMessageType.CREATE_DIR:

            data =
                createDir(_data);

            break;


        /* ==================================================
           LIST DIR
           ================================================== */

        case FFMessageType.LIST_DIR:

            data =
                listDir(_data);

            break;


        /* ==================================================
           DELETE DIR
           ================================================== */

        case FFMessageType.DELETE_DIR:

            data =
                deleteDir(_data);

            break;


        /* ==================================================
           MOUNT
           ================================================== */

        case FFMessageType.MOUNT:

            data =
                mount(_data);

            break;


        /* ==================================================
           UNMOUNT
           ================================================== */

        case FFMessageType.UNMOUNT:

            data =
                unmount(_data);

            break;


        /* ==================================================
           UNKNOWN
           ================================================== */

        default:

            throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }

} catch (error) {

    console.error(
        "[FFmpeg Worker ERROR]",
        error
    );

    self.postMessage({
        id,
        type: FFMessageType.ERROR,
        data: error?.toString
            ? error.toString()
            : String(error),
    });

    return;
}


/* ==========================================================
   Transferable 처리
   ========================================================== */

if (
    data instanceof Uint8Array
) {
    trans.push(
        data.buffer
    );
}


self.postMessage(
    {
        id,
        type,
        data,
    },
    trans
);
```

};
