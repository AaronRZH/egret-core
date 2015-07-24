/// <reference path="../lib/types.d.ts" />

import params = require("../ParamsParser");
import config = require("../lib/ProjectConfig");
import globals = require("../Globals");
import file = require("../lib/FileUtil");
import GenerateVersionCommand = require("./GenerateVersionCommand");

import ZipCMD = require("./ZipCommand");

import CompressJsonCMD = require("./CompressJsonCommand");
import ChangeEntranceCMD = require("./ChangeEntranceCommand");
import CompileFilesCMD = require("./CompileFilesCommand");
import FileAutoChangeCommand = require("./FileAutoChangeCommand");

class PublishNativeCommand implements egret.Command {
    execute():number {
        //获取到版本号
        var versionFile = params.getOption("--version") || Math.round(Date.now() / 1000);
        //当前发布的平台

        this.publish(versionFile);

        return 0;
    }

    private publish(versionFile) {
        var versionCtr = require("../utils/getVersionCtr").getVersionCtr();

        var timeMinSec = Date.now();

        globals.log2(1402, "native", versionFile + "");

        var projectPath = params.getProjectRoot();
        var releasePath = config.getReleaseRoot();
        var ziptempPath = file.joinPath(releasePath, "ziptemp");
        file.remove(ziptempPath);

        var releaseOutputPath = file.joinPath(releasePath, "android", versionFile + "");
        if (file.exists(releaseOutputPath)) {
            file.remove(releaseOutputPath);
        }
        file.createDirectory(releaseOutputPath);

        var task = [];

        //js文件
        //获取gamelist以及egretlist
        var file_list = config.getAllFileList("native");
        var needCompile = params.hasOption("-compile") || params.hasOption("-compiler");
        if (needCompile) {//压缩js文件，并拷贝到ziptemp目录中
            task.push((tempCallback)=> {
                var adapt = new CompileFilesCMD();
                var options = {
                    "--output": file.joinPath(ziptempPath, "launcher", "game-min-native.js"),
                    "--filelist": file_list
                };
                if (params.hasOption("--method")) {
                    options["--method"] = params.getOption("--method");
                }
                adapt.initOptions(options);
                adapt.execute(function (exitCode) {
                    tempCallback();
                });
            });
        }
        else {
            task.push((tempCallback)=> {
                var tempTime = Date.now();
                //拷贝到ziptemp目录中
                globals.debugLog(1405);
                file_list.map(function (item) {
                    var re = file.relative(projectPath, item);
                    file.copy(item, file.join(ziptempPath, re));
                });

                file.copy(file.join(projectPath, "bin-debug", "lib", "egret_file_list_native.js"), file.join(ziptempPath, "bin-debug", "lib", "egret_file_list.js"));
                file.copy(file.join(projectPath, "bin-debug", "src", "game_file_list.js"), file.join(ziptempPath, "bin-debug", "src", "game_file_list.js"));

                globals.debugLog(1406, (Date.now() - tempTime) / 1000);
                tempCallback();
            });
        }

        //生成版本控制文件到nativeBase里
        if (true) {
            task.push(function (tempCallback) {
                //是否要重新生成当前版本的baseVersion文件
                var freshBaseVersion = params.hasOption("-freshBaseVersion");
                if (freshBaseVersion) {
                    file.remove(file.join(releasePath, "nativeBase"));
                }

                var genVer = new GenerateVersionCommand();
                genVer.execute();

                tempCallback();
            });
        }

        var nozip = params.hasOption("-nozip");
        if (true) {//拷贝其他需要打到zip包里的文件
            task.push(function (tempCallback) {
                //拷贝需要zip的文件
                //拷贝版本控制文件
                versionCtr.copyZipManifest(releasePath, ziptempPath);

                //修改文件
                var fileModify = new FileAutoChangeCommand();
                fileModify.needCompile = needCompile;
                fileModify.debug = nozip;
                fileModify.versonCtrClassName = versionCtr.getClassName();
                fileModify.execute();

                file.copy(file.join(projectPath, "launcher", "native_loader.js"), file.join(ziptempPath, "launcher", "native_loader.js"));
                file.copy(file.join(projectPath, "launcher", "runtime_loader.js"), file.join(ziptempPath, "launcher", "runtime_loader.js"));
                file.copy(file.join(projectPath, "launcher", "native_require.js"), file.join(ziptempPath, "launcher", "native_require.js"));

                tempCallback();
            });
        }

        //打zip包
        if (nozip) {//不需要打zip包
            task.push(function (tempCallback) {
                var tempTime = Date.now();
                globals.debugLog(1414);
                file.copy(ziptempPath, releaseOutputPath);
                file.remove(ziptempPath);
                globals.debugLog(1409, (Date.now() - tempTime) / 1000);
                tempCallback();
            });
        }
        else {//打zip包
            task.push(function (tempCallback) {
                var zip = new ZipCMD();
                zip.initOptions({
                    "--output": file.join(releaseOutputPath, "game_code_" + versionFile + ".zip"),
                    "--source": ziptempPath,
                    "--password": params.getOption("--password") || ""
                });
                zip.execute(function (exitCode) {
                    tempCallback();
                });
            });
        }

        //拷贝其他资源文件
        if (true) {//拷贝其他文件到发布目录
            task.push(function (tempCallback) {
                //拷贝其他不需要放入到zip的版本控制的文件
                versionCtr.copyOtherManifest(releasePath, releaseOutputPath, nozip);

                //获取已经筛选过的资源列表
                var versionInfo = JSON.parse(file.read(file.join(releasePath, "nativeBase", "all.manifest")));
                versionCtr.copyFilesWithIgnore(projectPath, releaseOutputPath, versionInfo);

                var compressJson = new CompressJsonCMD();
                compressJson.initOptions({
                    "--source" : releaseOutputPath
                });
                compressJson.execute();
                tempCallback();
            });
        }

        //拷贝到native工程中
        if (true) {
            task.push(function (tempCallback) {
                var startTime = Date.now();

                //apk
                var androidRoot = config.getNativePath("android");
                if (androidRoot != null) {
                    var url1 = file.join(androidRoot, "proj.android");
                    var url2 = file.join(androidRoot, "proj.android/assets");
                    if (file.exists(url1)) {//是egret的android项目
                        //1、清除文件夹
                        file.remove(file.join(url2, "egret-game"));
                        file.createDirectory(file.join(url2, "egret-game"));
                        file.copy(releaseOutputPath, file.join(url2, "egret-game"));

                        //修改java文件
                        var entrance = new ChangeEntranceCMD();
                        if (nozip) {
                            entrance.initCommand(url1, "android");
                        }
                        else {
                            entrance.initCommand(url1, "android", versionFile);
                        }
                        entrance.execute();
                    }
                }

                var iosRoot = config.getNativePath("ios");
                if (iosRoot != null) {
                    var url1 = file.join(iosRoot, "proj.ios");
                    var url2 = file.join(iosRoot, "Resources");

                    if (file.exists(url1) && file.exists(url2)) {//是egret的ios项目
                        //1、清除文件夹
                        file.remove(file.join(url2, "egret-game"));

                        file.createDirectory(file.join(url2, "egret-game"));
                        file.copy(releaseOutputPath, file.join(url2, "egret-game"));

                        //修改java文件
                        var entrance = new ChangeEntranceCMD();
                        if (nozip) {
                            entrance.initCommand(url1, "ios");
                        }
                        else {
                            entrance.initCommand(url1, "ios", versionFile);
                        }
                        entrance.execute();
                    }
                }

                globals.log2(1412, (Date.now() - startTime) / 1000);

                tempCallback();
            });
        }

        var async = globals.getAsync();
        async.series(task, function (err) {
            if (!err) {
                globals.log2(1413, (Date.now() - timeMinSec) / 1000);
            }
            else {
                globals.exit(err);
            }
        });
    }
}

export = PublishNativeCommand;