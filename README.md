# nodehttpd
A http server using NodeJS.

This is not a web framework for NodeJS, this is a web server, currently for static files.

## Build
To build with `vscode` press `Ctrl + Shift + B` or otherwise run `npm run-script build`.

This downloads dependencies with `npm install`.

## Debug
To debug with `vscode` press `F5` or otherwise run `npm run-script start`.

With VSCode it will open run the web server and a debug instance of Chrome with working breakpoints. 

If running by hand or to open in a another browser visit by default: `http://127.0.0.1:8080`

## About
This was written because I just wanted a simple static web server without dependencies and to see
how NodeJS coped with it out of the box.

I saw some brief examples of using the http module, but they were not using the latest features and/or
did not have simple path checks.

I've also started by committing the first working draft version I pushed with another project, I have also
written such a thing before wanting a static server and have other draft NodeJS modules which I may release.
