const electron = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const openAboutWindow = require('about-window').default;
const {download} = require("electron-dl");
const github = require('octonode');
const githubClient = github.client();
const {app, BrowserWindow, ipcMain, ipcRenderer, Menu} = electron;
const spawn = require('child_process').spawn;
const http = require('http');
// const tar = require('tar');
const decompress = require('decompress');

let installWindow;
let mainWindow;

let availableDownloads = [];
let electroneumTag;
let daemonVersion;

let platform = os.platform();
if(platform == "win32") { platform = "win"; }

app.on('ready', function(){
    // Create the window
    // splashWindow = new BrowserWindow({center: true, frame: false, height: 400, width: 600});
    splashWindow = new BrowserWindow({height: 600, resizable: false, width: 1080});
    splashWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'pages/splash/splash.html'),
        // pathname: path.join(__dirname, 'pages/wallet/wallet.html'),
        protocol: 'file:',
        slashes: true
    }));
    // splashWindow.send("display-splash-message", "Loading ...");

    // Build the menu with the default template
    // const mainMenu = Menu.buildFromTemplate(defaultMenuTemplate);
    // Add the menu
    // Menu.setApplicationMenu(mainMenu);
});

ipcMain.on("check-install", (event, arg) => {
    splashWindow.send("display-splash-message", "Checking for updates ...");
    // Get the release info from GitHub
    var releases = githubClient.get('/repos/electroneum/electroneum/releases/latest', function (err, status, body, headers) {
        const tag = body.tag_name;
        electroneumTag = tag;
        availableDownloads[tag] = [];
        for(i in body.assets) {
            var fullAssetName = body.assets[i].name;
            assetPartials = fullAssetName.split("-");
            // Rewrite the platform names to match node.js platform names
            switch(assetPartials[1]) {
                case 'macOS':
                    assetPartials[1] = 'darwin';
                    break;
                case 'windows':
                    assetPartials[1] = 'win32';
                    break;
            }
            availableDownloads[tag][assetPartials[1]] = {
                arch: assetPartials[2],
                filename: fullAssetName,
                size: body.assets[i].size,
                url: body.assets[i].browser_download_url
            }
        }

        // Create directory if required
        if(!fs.existsSync(path.join(__dirname, 'assets/bin/', tag))) {
            console.log('Create directory for version being downloaded ... ' + path.join(__dirname, 'assets/bin/', tag));
            fs.mkdirSync(path.join(__dirname, 'assets/bin/', tag));
        } else {
            // Check to see if the file is already downloaded
            if(fs.existsSync(path.join(__dirname, 'assets/bin/', tag, availableDownloads[tag][platform].filename))) {
                // Check the daemon file exists
                if(fs.existsSync(path.join(__dirname, 'assets/bin/', tag, "electroneumd"))) {
                    splashWindow.send("extract-complete");
                } else {
                    // The file is downloaded so now send the trigger to unzip the package
                    splashWindow.send("start-install");
                }
                return;
            }
        }

        splashWindow.send("display-splash-message", "Downloading dependencies ...");

        // Download the file from github - once the file is downloaded so now send the trigger to unzip the package
        download(BrowserWindow.getFocusedWindow(), availableDownloads[tag][platform].url, {directory: path.join(__dirname, 'assets/bin/', tag)})
            .then(dl => splashWindow.send("start-install"));

    });
});

ipcMain.on("install-dependencies", (event, arg) => {
    splashWindow.send("display-splash-message", "Installing dependencies ...");
    if(platform == "win32") {
        // Extract the zip file
        // never use readFileSync - only used here to simplify the example
        var buffer = fs.readFileSync(path.join(__dirname, 'assets/bin/', electroneumTag, availableDownloads[electroneumTag][platform].filename));  

        unzipper.Open.buffer(buffer)
        .then(function(d) {
            console.log('directory',d);
            return new Promise(function(resolve,reject) {
            d.files[0].stream()
                .pipe(fs.createWriteStream('firstFile'))
                .on('error',reject)
                .on('finish',resolve)
            });
        });
    } else {
        decompress(
            path.join(__dirname, 'assets/bin/', electroneumTag, availableDownloads[electroneumTag][platform].filename), 
            path.join(__dirname, 'assets/bin/', electroneumTag)
        ).then(files => {
            splashWindow.send("extract-complete");
        });
    }
});

ipcMain.on("init-blockchain", (event, arg) => {
    splashWindow.send("display-splash-message", "Starting electroneum daemon ...");
    const proc = spawn(path.join(__dirname, 'assets/bin/', electroneumTag, 'electroneumd'));

    proc.once('error', error => {
        console.log("error with the daemon")
        console.log(error.toString('utf8'));
    });

    proc.stdout.on('data', data => {
        console.log("data received from node");
        if(data.toString('utf8').indexOf("src/daemon/main.cpp:280") != -1) {
            version = data.toString('utf8').split('\t');
            index = version.length - 1;
            daemonVersion = version[index];
        } else if(data.toString('utf8').indexOf("The daemon will start synchronizing with the network. This may take a long time to complete.") != -1) {
            // When we see this message, it means the daemon has started successfully and is now syncing the blockchain
            // Let's display the sync progress on the splash screen so the user see's that something is actually happening
            setTimeout(function(){
                fetchAndDisplaySyncProgress();
            }, 3000);
        } else if(data.toString('utf8').indexOf("src/cryptonote_protocol/cryptonote_protocol_handler.inl:1152") && data.toString('utf8').indexOf("Synced")) {
            fetchAndDisplaySyncProgress();
        }
        console.log(data.toString('utf8'));
    });

    splashWindow.loadURL(url.format({
        // pathname: path.join(__dirname, 'pages/splash/splash.html'),
        pathname: path.join(__dirname, 'pages/app/main.html'),
        protocol: 'file:',
        slashes: true
    }));

    proc.stderr.on('data', data => {
        console.log("some kind of error from daemon");
        console.log(data.toString('utf8'));
    });
});

function fetchAndDisplaySyncProgress() {
    console.log("get local height");
    jsonRpcRequest({}, "/getinfo").then((data) => {
        splashWindow.send("display-splash-message", "Syncing blockchain " + data.height + "/" + ((data.target_height == 0) ? data.height : data.target_height));
        console.log(typeof data.height);
        console.log(typeof data.target_height);
        console.log(typeof data.height == "number" && typeof data.target_height == "number" && data.target_height > 0);
        if(typeof data.height == "number" && typeof data.target_height == "number" && data.target_height > 0) {
            var percentSynced = ((data.height / data.target_height) * 100);
            console.log("percent " + percentSynced);
            splashWindow.send("networkSyncing", percentSynced);
        }
    });
}

function jsonRpcRequest (body, path) {
    console.log("start json request");
    let requestJSON = JSON.stringify(body)
    // set basic headers
    let headers = {}
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(requestJSON, 'utf8')
    // make a request to the wallet
    let options = {
      hostname: '127.0.0.1',
      port: '26968',
      path: (path != null ? path : '/json_rpc'),
      method: 'POST',
      headers: headers
    }
    let requestPromise = new Promise((resolve, reject) => {
        let data = ''
        let req = http.request(options, (res) => {
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
                data += chunk
            })
            res.on('end', function () {
                let body = JSON.parse(data)
                if (body && body.status == "OK") {
                    resolve(body)
                } else if (body && body.error) {
                    resolve(body.error)
                } else {
                    resolve('Wallet response error. Please try again.')
                }
            })
        })
        req.on('error', (e) => resolve(e))
        req.write(requestJSON)
        req.end()
    })
    return requestPromise
}

// fetchLatestDownloads() {
//     
// }

ipcMain.on("trigger-download-dependencies", (event, arg) => {
    installWindow.send("download-started", arg.tag_name);
    const tag = arg.tag_name;
    availableDownloads[tag] = [];
    for(i in arg.assets) {
        var fullAssetName = arg.assets[i].name;
        assetPartials = fullAssetName.split("-");
        // Rewrite the platform names to match node.js platform names
        switch(assetPartials[1]) {
            case 'macOS':
                assetPartials[1] = 'darwin';
                break;
            case 'windows':
                assetPartials[1] = 'win32';
                break;
        }
        availableDownloads[tag][assetPartials[1]] = {
            arch: assetPartials[2],
            filename: fullAssetName,
            size: arg.assets[i].size,
            url: arg.assets[i].browser_download_url
        }
    }

    // Create directory if required
    if(!fs.existsSync(path.join(__dirname, 'assets/bin/', tag))) {
        console.log('Create directory for version being downloaded ... ' + path.join(__dirname, 'assets/bin/', tag));
        fs.mkdirSync(path.join(__dirname, 'assets/bin/', tag));
    }

    // Download the file from github
    download(BrowserWindow.getFocusedWindow(), availableDownloads[tag][platform].url, {directory: path.join(__dirname, 'assets/bin/', tag, availableDownloads[tag][platform].filename)})
        .then(dl => console.log("do something after download"));

    // installWindow.webContents.session.on('will-download', (event, item, webContents) => {
    //     

    //     // Set the save path, making Electron not to prompt a save dialog.
    //     item.setSavePath(path.join(__dirname, 'bin/', tag, availableDownloads[tag][os.platform()]))
    //     item.on('updated', (event, state) => {
    //       if (state === 'interrupted') {
    //         console.log('Download is interrupted but can be resumed')
    //       } else if (state === 'progressing') {
    //         if (item.isPaused()) {
    //           console.log('Download is paused')
    //         } else {
    //           console.log(`Received bytes: ${item.getReceivedBytes()}`)
    //         }
    //       }
    //     })
    //     item.once('done', (event, state) => {
    //       if (state === 'completed') {
    //         console.log('Download successfully')
    //       } else {
    //         console.log(`Download failed: ${state}`)
    //       }
    //     })
    //   })
});

function hasDependencies() {
    // Check if assets are installed - if exist locally, return false; else return true;
    if(fs.existsSync(path.join(__dirname, 'assets/dependencies.zip'))) {
        return true;
    }
    return false;
}
function dependenciesInstalled() {
    return false;
}
function bcIsLoaded() {
    return false;
}
const defaultMenuTemplate = [
    {
        label: 'File',
        submenu: [
            {
                label: 'Quit',
                accelerator: process.platform == 'darwin' ? 'Command+Q' : 'Ctrl+Q',
                click() {
                    app.quit();
                }
            }
        ],
    },
    {
        label: 'Help',
        submenu: [
            {
                label: 'About',
                click() {
                    openAboutWindow({
                        icon_path: path.join(__dirname, 'assets/appicon.ico'),
                        copyright: 'Copyright 2018 OfficiallyUndead',
                        package_json_dir: __dirname,
                        // open_devtools: process.env.NODE_ENV !== 'production',
                    });
                }
            }
        ]
    }
];