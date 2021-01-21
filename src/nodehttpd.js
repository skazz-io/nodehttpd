const http = require('http');
const path = require('path');
const { promises: fs, createReadStream } = require('fs');
const cluster = require('cluster');
const { cpus } = require('os');

var config = {
    wwwroot: './',
    port: 8080,
    threads: cpus().length,
    defaultFile: 'index.html',
    checkHidden: true,
    checkAccepts: true,
    checkRootMount: true,
    noLog: false,
    textLog: false,
    workerLog: false,
    mime: {
        '.html': 'text/html',
        '.css': 'text/css',
        '.webmanifest': 'application/manifest+json',
        '.js': 'text/javascript',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.eot': 'appliaction/vnd.ms-fontobject',
        '.ttf': 'appliaction/font-sfnt',
        '.json': 'appliaction/json'
    },
    defaultHeaders: {
        // 'Strict-Transport-Security': ['max-age=31536000', 'includeSubDomains'],
        'X-Frame-Options': 'deny',
        'X-Content-Type-Options': 'nosniff',
        // 'Content-Security-Policy': 'script-src self',
        'X-Permitted-Cross-Domain-Policies': 'none',
        'Referrer-Policy': 'no-referrer',
        // 'Feature-Policy': ["vibrate 'none'", "geolocation 'none'"],
        // 'Access-Control-Allow-Origin': ''
    },
    cors: true,
    corsHeaders: {
        'Access-Control-Allow-Origin': 'https://127.0.0.1:8080',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'X-PINGOTHER, Content-Type',
        'Access-Control-Max-Age': 86400
    }
}

config.wwwroot = process.env.NODE_HTTP_ROOT ? process.env.NODE_HTTP_ROOT : config.wwwroot;
config.port = process.env.NODE_HTTP_PORT ? Number(process.env.NODE_HTTP_PORT) : config.port;
config.threads = process.env.NODE_HTTP_THREADS ? Number(process.env.NODE_HTTP_THREADS) : config.threads;

if (config.port != 8080 && config.corsHeaders && config.corsHeaders['Access-Control-Allow-Origin']) {
    if (config.corsHeaders['Access-Control-Allow-Origin'].endsWith('8080')) {
        config.corsHeaders['Access-Control-Allow-Origin'] = `'https://127.0.0.1:${config.port}'`
    }
}


if (config.checkRootMount && !config.wwwroot) {
    throw 'config.wwwroot must be set, even if it is current directory with a dot.';
}

const chroot = path.resolve(config.wwwroot);
const defaultExt = path.extname(config.defaultFile);
const hiddenCheck = new RegExp(/\/\./);

if (config.checkRootMount && chroot == path.sep) {
    throw 'Cannot set wwwroot to system root without checkRootMount set to false.';
}

function mimeAcceptCheck(mime, accept) {
    return config.checkAccepts && accept &&
        accept.indexOf('*/*') == -1 &&
        accept.indexOf(`${mime.split('/')[0]}/*`) == -1 &&
        accept.indexOf(mime) == -1;
}

var writeLog = function (message, ...optionalParams) {
    console.log(message, ...optionalParams);
};
var writeHost = function (message, ...optionalParams) {
    console.warn(`${new Date().toISOString()}: ${message}`, ...optionalParams)
};
var sendLog = function (message) {
    process.send(JSON.stringify(message));
};
var recieveLog = function (message) {
    writeLog(JSON.parse(message));
};

if (config.textLog) {
    writeLog = function (message, ...optionalParamse) {
        console.log(JSON.stringify(message), ...optionalParamse);
    };
    recieveLog = function (message) {
        console.log(message);
    };
}

if (config.workerLog) {
    sendLog = writeLog;
}

if (config.threads > 0) {
    if (cluster.isMaster) {
        writeHost(`Server starting on port ${config.port} with ${config.threads} workers.`)

        cluster.on('fork', function(worker) {
            writeHost('worker started', worker.process.pid)
        });

        cluster.on('exit', function(worker, code, signal) {
            writeHost('worker died', worker.process.pid, code, signal);
            cluster.fork();
        });

        if (!config.workerLog && !config.noLog) {
            cluster.on('message', function (worker, message, handle) {
                recieveLog(message);
            });
        }

        for (var i = 0; i < config.threads; i++) {
            cluster.fork({ NODE_CHILD: i });
        }

        return;
    }
} else {
    writeHost(`Server starting on port ${config.port} singlethreaded.`)
    sendLog = writeLog;
}

http.createServer(async function (req, res) {
    var start = Date.now();
    var url = null;
    var error = null;

    try {
        let host = `${req.socket.localAddress}:${req.socket.localPort}`;

        if (req.headers.host) {
            host = req.headers.host;
        }

        url = new URL(req.url, `http://${host}`);

        if (config.checkHidden && hiddenCheck.test(url.pathname)) {
            throw 404;
        }

        for (var key in config.defaultHeaders) {
            res.setHeader(key, config.defaultHeaders[key]);
        }

        if (config.cors && req.method == 'OPTIONS') {
            for (var key in config.corsHeaders) {
                res.setHeader(key, config.corsHeaders[key]);
            }
            res.writeHead(204);
            return;
        }

        if (req.method != 'GET' && req.method != 'HEAD') {
            throw 405;
        }

        let localPath = path.resolve(path.join(config.wwwroot, url.pathname));

        if (!localPath.startsWith(chroot)) {
            throw 404;
        }

        let localExt = path.extname(localPath);

        if (!localExt) {
            localPath = path.join(localPath, config.defaultFile);
            localExt = defaultExt;
        }

        let localMime = config.mime[localExt];

        if (!localMime) {
            throw 404;
        }

        if (mimeAcceptCheck(localMime, req.headers.accept)) {
            throw 406;
        }
        
        let stats = await fs.stat(localPath);
        
        res.setHeader('Content-Type', localMime);

        if (stats.isFile()) {
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Last-Modified', stats.mtime.toUTCString());
        }

        res.writeHead(200);

        if (req.method == 'HEAD') {
            return;
        }

        let stream = createReadStream(localPath);

        await new Promise((resolve, reject) => {
            stream.on('error', function (err) {
                reject(err);
            });

            stream.once('open', function () {
                stream.pipe(res, { end: false });
            });

            stream.on('end', function () {
                resolve();
            })
        });
    } catch (err) {
        if (err >= 100 && err < 600) {
            res.statusCode = err;
        } else if (err.code == 'ENOENT') {
            res.statusCode = 404;
        } else {
            res.statusCode = 500;
            error = err;
        }
    } finally {
        try {
            if (!res.headersSent) {
                if (req.method == 'HEAD' || req.statusCode == 204) {
                    res.writeHead(res.statusCode);
                } else {
                    await new Promise((resolve, reject) => {
                        var body = null;
                        var msg = http.STATUS_CODES[res.statusCode] || null;
                        var code = Number(res.statusCode);

                        if (mimeAcceptCheck('application/json', req.headers.accept)) {
                            body = `{"httpCode":${code},"httpMessage":"${msg}"}`
                            res.setHeader('Content-Type', 'application/json');
                        } else if (mimeAcceptCheck('text/plain', req.headers.accept)) {
                            body = msg;
                            res.setHeader('Content-Type', 'text/plain');
                        } else if (mimeAcceptCheck('text/html', req.headers.accept)) {
                            body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${msg}</title><meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0" /></head><body><h1>HTTP ${code} - ${msg}</h1></body>`
                            res.setHeader('Content-Type', 'text/html');
                        }

                        if (body) {
                            res.setHeader('Content-Length', Buffer.byteLength(body));
                        }

                        res.writeHead(res.statusCode);
                        
                        if (!body) {
                            resolve();
                            return;
                        }

                        res.write(body, function (err) {
                            if (err) { reject(err); } else { resolve(); }
                        });
                    });
                }
            }
        } catch (err) {
            error = error ? [ error, err ] : err;
        }
        
        try { 
            res.end();
        } catch (err) { 
            if (!error) {
                error = err;
            } else if (Array.isArray(error)) {
                error.push(err);
            } else {
                error = [ error, err ];
            }
        }

        if (!config.noLog) {
            var end = Date.now();
            var duration = end - start;

            sendLog({
                ts: new Date(start).toISOString(),
                remoteAddress: req.socket.remoteAddress,
                method: req.method,
                url: url.toString(),
                agent: req.headers['user-agent'],
                statusCode: res.statusCode,
                bytesRead: req.socket.bytesRead,
                bytesWritten: req.socket.bytesWritten,
                duration: duration,
                error: error
            });
        }
    }
}).listen(config.port);
