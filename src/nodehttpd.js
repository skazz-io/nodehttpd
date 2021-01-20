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
    allowHidden: false,
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

const chroot = path.resolve(config.wwwroot);
const defaultExt = path.extname(config.defaultFile);

if (config.threads > 0) {
    if (cluster.isMaster) {
        console.log(`Server starting on port ${config.port} with ${config.threads} workers.`)

        cluster.on('fork', function(worker) {
            console.log('worker started', worker.process.pid)
        });

        cluster.on('exit', function(worker, code, signal) {
            console.log('worker died', worker.process.pid, code, signal);
            cluster.fork();
        });

        for (var i = 0; i < config.threads; i++) {
            cluster.fork({ NODE_CHILD: i });
        }

        return;
    }
} else {
    console.log(`Server starting on port ${config.port} singlethreaded.`)
    sendLog = console.log;
}

http.createServer(async function (req, res) {
    var start = Date.now();
    var url = null;
    var error = null;

    try {
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

        let host = `${req.socket.localAddress}:${req.socket.localPort}`;

        if (req.headers.host) {
            host = req.headers.host;
        }

        url = new URL(req.url, `http://${host}`);

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
        try { res.end(); } catch (err) { error = error ? [ error, err ] : err; }

        var end = Date.now();
        var duration = end - start;

        console.log({
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
}).listen(config.port);
