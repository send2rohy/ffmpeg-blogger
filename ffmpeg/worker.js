/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { FFMessageType } from "./const.js";
import {
    ERROR_UNKNOWN_MESSAGE_TYPE,
    ERROR_NOT_LOADED,
    ERROR_IMPORT_FAILURE,
} from "./errors.js";

let ffmpeg = null;

/*
 * ============================================================
 * FFmpeg 0.12.10
 * ============================================================
 *
 * core.js  : GitHub Pages
 * wasm     : jsDelivr 공식 패키지
 *
 * 중요:
 * - UMD core 사용
 * - ffmpeg-core.worker.js 사용 안 함
 * - core.js Blob 사용 안 함
 * - wasm Blob 사용 안 함
 */

const CORE_URL =
    "https://send2rohy.github.io/ffmpeg-blogger/ffmpeg/ffmpeg-core.js";

const WASM_URL =
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm";


const load = async ({
    coreURL: _coreURL,
    wasmURL: _wasmURL,
    workerURL: _workerURL,
} = {}) => {

    const first = !ffmpeg;

    const coreURL = _coreURL || CORE_URL;
    const wasmURL = _wasmURL || WASM_URL;

    /*
     * 0.12.10 single-thread UMD에는
     * ffmpeg-core.worker.js가 필요하지 않다.
     */
    const workerURL = _workerURL || "";

    /*
     * --------------------------------------------------------
     * UMD core 로딩
     * --------------------------------------------------------
     *
     * 이 worker가 classic worker라면 importScripts()
     * module worker라면 fetch + eval 방식으로 UMD를 로드한다.
     */

    try {

        if (typeof importScripts === "function") {

            try {
                importScripts(coreURL);
            } catch (e) {
                console.warn(
                    "[FFmpeg] importScripts 실패:",
                    e
                );
            }
        }

        /*
         * UMD 파일이 정상적으로 로드되면
         * createFFmpegCore가 전역에 생성된다.
         */
        if (typeof self.createFFmpegCore !== "function") {

            /*
             * module worker에서는 importScripts가 사용할 수 없으므로
             * core.js를 직접 받아서 실행한다.
             */
            const response = await fetch(coreURL, {
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error(
                    `ffmpeg-core.js HTTP ${response.status}`
                );
            }

            const source = await response.text();

            /*
             * UMD 파일을 Worker 전역 환경에서 실행.
             */
            const runCore = new Function(
                source + "\n//# sourceURL=" + coreURL
            );

            runCore();
        }

    } catch (e) {

        console.error(
            "[FFmpeg] core.js 로딩 실패:",
            e
        );

        throw new Error(
            "ffmpeg-core.js 로딩 실패: " +
            (e && e.message ? e.message : String(e))
        );
    }


    if (typeof self.createFFmpegCore !== "function") {

        throw ERROR_IMPORT_FAILURE;
    }


    /*
     * --------------------------------------------------------
     * FFmpeg Core 생성
     * --------------------------------------------------------
     *
     * mainScriptUrlOrBlob에 coreURL과 wasmURL을 전달한다.
     *
     * 0.12 계열에서 locateFile 문제를 피하기 위해
     * 공식 worker 구조에서 사용하는 URL encoding 방식을 유지한다.
     */

    try {

        const config = {
            wasmURL: wasmURL,
        };

        /*
         * single-thread에서는 workerURL이 필요 없다.
         */

        const encodedConfig = btoa(
            JSON.stringify(config)
        );

        ffmpeg = await self.createFFmpegCore({

            mainScriptUrlOrBlob:
                `${coreURL}#${encodedConfig}`,

        });

    } catch (e) {

        console.error(
            "[FFmpeg] createFFmpegCore 실패:",
            e
        );

        throw new Error(
            "FFmpeg Core 초기화 실패: " +
            (e && e.message ? e.message : String(e))
        );
    }


    /*
     * --------------------------------------------------------
     * Logger
     * --------------------------------------------------------
     */

    ffmpeg.setLogger((data) => {

        self.postMessage({
            type: FFMessageType.LOG,
            data,
        });

    });


    /*
     * --------------------------------------------------------
     * Progress
     * --------------------------------------------------------
     */

    ffmpeg.setProgress((data) => {

        self.postMessage({
            type: FFMessageType.PROGRESS,
            data,
        });

    });


    return first;
};


/*
 * ============================================================
 * EXEC
 * ============================================================
 */

const exec = ({
    args,
    timeout = -1,
}) => {

    ffmpeg.setTimeout(timeout);

    ffmpeg.exec(...args);

    const ret = ffmpeg.ret;

    ffmpeg.reset();

    return ret;
};


/*
 * ============================================================
 * FILE SYSTEM
 * ============================================================
 */

const writeFile = ({
    path,
    data,
}) => {

    ffmpeg.FS.writeFile(path, data);

    return true;
};


const readFile = ({
    path,
    encoding,
}) => {

    return ffmpeg.FS.readFile(
        path,
        { encoding }
    );
};


const deleteFile = ({
    path,
}) => {

    ffmpeg.FS.unlink(path);

    return true;
};


const rename = ({
    oldPath,
    newPath,
}) => {

    ffmpeg.FS.rename(
        oldPath,
        newPath
    );

    return true;
};


const createDir = ({
    path,
}) => {

    ffmpeg.FS.mkdir(path);

    return true;
};


const listDir = ({
    path,
}) => {

    const names = ffmpeg.FS.readdir(path);

    const nodes = [];

    for (const name of names) {

        const stat =
            ffmpeg.FS.stat(
                `${path}/${name}`
            );

        const isDir =
            ffmpeg.FS.isDir(
                stat.mode
            );

        nodes.push({
            name,
            isDir,
        });
    }

    return nodes;
};


const deleteDir = ({
    path,
}) => {

    ffmpeg.FS.rmdir(path);

    return true;
};


const mount = ({
    fsType,
    options,
    mountPoint,
}) => {

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
};


const unmount = ({
    mountPoint,
}) => {

    ffmpeg.FS.unmount(
        mountPoint
    );

    return true;
};


/*
 * ============================================================
 * MESSAGE HANDLER
 * ============================================================
 */

self.onmessage = async ({
    data: {
        id,
        type,
        data: _data,
    },
}) => {

    const trans = [];

    let data;

    try {

        if (
            type !== FFMessageType.LOAD &&
            !ffmpeg
        ) {
            throw ERROR_NOT_LOADED;
        }


        switch (type) {

            case FFMessageType.LOAD:

                data = await load(
                    _data || {}
                );

                break;


            case FFMessageType.EXEC:

                data = exec(_data);

                break;


            case FFMessageType.WRITE_FILE:

                data = writeFile(_data);

                break;


            case FFMessageType.READ_FILE:

                data = readFile(_data);

                break;


            case FFMessageType.DELETE_FILE:

                data = deleteFile(_data);

                break;


            case FFMessageType.RENAME:

                data = rename(_data);

                break;


            case FFMessageType.CREATE_DIR:

                data = createDir(_data);

                break;


            case FFMessageType.LIST_DIR:

                data = listDir(_data);

                break;


            case FFMessageType.DELETE_DIR:

                data = deleteDir(_data);

                break;


            case FFMessageType.MOUNT:

                data = mount(_data);

                break;


            case FFMessageType.UNMOUNT:

                data = unmount(_data);

                break;


            default:

                throw ERROR_UNKNOWN_MESSAGE_TYPE;
        }


    } catch (e) {

        console.error(
            "[FFmpeg Worker ERROR]",
            e
        );

        self.postMessage({

            id,

            type: FFMessageType.ERROR,

            data:
                e && e.message
                    ? e.message
                    : String(e),

        });

        return;
    }


    if (data instanceof Uint8Array) {

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
};
