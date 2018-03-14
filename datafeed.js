/*
  This file is a node.js module.

  This is an implementation of UDF-compatible datafeed wrapper for poloniex
  Some algorithms may be icorrect because it's rather an UDF implementation sample
  then a proper datafeed implementation.

  https://codeforgeek.com/2015/01/nodejs-mysql-tutorial/
*/

const config = require('./config');
const http = require(config.https ? 'https' : 'http');
const url = require('url');
const symbolsDatabase = require('./symbols_database');
const https = require('https'); // propose to remove this from both polo and coinbase
const path = require('path');
const fs = require('fs');

let options = {};

if (config.https) {
  options = {
    key: fs.readFileSync('certs/priv.pem'),
    cert: fs.readFileSync('certs/cert.pem'),
  };
}

const datafeedHost = config.feedSourceIP;
const datafeedPort = config.feedSourcePort;
const defaultResponseHeader = {
  'Content-Type': 'text/plain',
  'Access-Control-Allow-Origin': '*',
};

const httpGet = (path, callback) => {
  const options = {
    host: datafeedHost,
    port: datafeedPort,
    path: path,
  };

  const onDataCallback = (response) => {
    let result = '';

    response.on('data', (chunk) => {
      result += chunk
    });

    response.on('end', () => {
      callback(result)
    });
  }

  const req = require('http').request(options, onDataCallback);

  req.on('socket', (socket) => {
    socket.setTimeout(35000);

    socket.on('timeout', () => {
      console.log('timeout');
      req.abort();
    });
  });

  req.on('error', (e) => {
    console.log(`Problem with request: ${e.message}`);
  });

  req.end();
}

const convertDataToUDFFormat = (data) => { // propose to alter this
  const result = {
    t: [], c: [], o: [], h: [], l: [], v: [],
    s: [],
  };
  let lines;

  try {
    lines = JSON.parse(data);
  } catch(e) {
    console.log('malformed request', data);
    return `{ "error": "malformed request: ${data} " }`;
  }

  if (lines.length === 0) {
    result.s = 'no_data';
  } else {
    for (let i = 0; i < lines.length; i++) {
      const items = lines[i];
      result.s = 'ok';

      if (parseInt(items[0]) != 0) {
        result.t.push(parseInt(items[0])); // date
        result.o.push(parseFloat(items[3])); // open
        result.h.push(parseFloat(items[1])); // high
        result.l.push(parseFloat(items[2])); // low
        result.c.push(parseFloat(items[4])); // close
        result.v.push(parseFloat(items[5])); // relvol or 6 basevol
      }
    }
  }

  return result;
}

RequestProcessor = function(action, query, response) {
  this.sendError = (error, response) => {
    response.writeHead(200, defaultResponseHeader);
    response.write("{\"s\":\"error\",\"errmsg\":\"" + error + "\"}");
    response.end();
    console.log(error);
  }

  this.sendConfig = (response) => {
    const config = {
      supports_search: true,
      supports_group_request: false,
      supports_marks: false,
      supports_timescale_marks: false,
      exchanges: [
        {
          value: '',
          name: 'All Exchanges',
          desc: '',
        },
        {
          value: 'BARTERDEX',
          name: 'BarterDEX',
          desc: 'BarterDEX',
        },
      ],
      symbolsTypes: [
        {
          name: 'All types',
          value: '',
        },
        {
          name: 'Barterdex',
          value: 'barterdex',
        },
        {
          name: 'Index',
          value: 'index',
        },
      ],
      supportedResolutions: [
        '1',
        '5',
        '15',
        '30',
        '60',
        '120',
        '240',
        'D',
        'W'
      ],
    };

    response.writeHead(200, defaultResponseHeader);
    response.write(JSON.stringify(config));
    response.end();
  }

  this.sendSymbolSearchResults = (query, type, exchange, maxRecords, response) => {
    if (!maxRecords) {
      throw 'wrong_query';
    }

    const result = symbolsDatabase.search(query, type, exchange, maxRecords);

    response.writeHead(200, defaultResponseHeader);
    response.write(JSON.stringify(result));
    response.end();
  }

  this.sendSymbolInfo = (symbolName, response) => {
    const symbolInfo = symbolsDatabase.symbolInfo(symbolName);

    if (symbolInfo === null) {
      throw `unknown_symbol ${symbolName}`;
    }

    const exchange = 'barterdex';
    const pairArray = symbolInfo.name.split('-');
    const address = `/api/stats/tradesarray?base=${pairArray[0]}&rel=${pairArray[1]}&starttime=0&endtime=0&timescale=60`;

    const that = this;

    httpGet(address, (result) => {
      let resultAll;

      try {
        resultAll = JSON.parse(result);
      } catch(e) {}

      const lastPrice = resultAll[0][1];
      //  BEWARE: this `pricescale` parameter computation algorithm is wrong and works
      //  for symbols with 10-based minimal movement value only
      const pricescale = lastPrice.indexOf('.') > 0 ? Math.pow(10, lastPrice.split('.')[1].length) : 10;

      const info = {
        'name': symbolInfo.name,
        'exchange-traded': symbolInfo.exchange,
        'exchange-listed': symbolInfo.exchange,
        'timezone': 'UTC',
        'minmov': 1,
        'minmov2': 0,
        'pricescale': pricescale,
        'pointvalue': 1,
        'session': '24x7',
        'has_intraday': true,
        'has_no_volume': false,
        'ticker': symbolInfo.name.toUpperCase(),
        'description': symbolInfo.description.length > 0 ? symbolInfo.description : symbolInfo.name,
        'type': symbolInfo.type,
        'supported_resolutions': [
          '1',
          '5',
          '15',
          '30',
          '60',
          '120',
          '240',
          'D',
          'W'
        ],
      };

      response.writeHead(200, defaultResponseHeader);
      response.write(JSON.stringify(info));
      response.end();
    });
  }

  this.sendSymbolHistory = (symbol, startDateTimestamp, endDateTimestamp, resolution, response) => {
    const symbolInfo = symbolsDatabase.symbolInfo(symbol);

    if (symbolInfo === null) {
      throw 'unknown_symbol';
    }

    if (resolution != '1' &&
        resolution != '5' &&
        resolution != '15' &&
        resolution != '30' &&
        resolution != '60' &&
        resolution != '120' &&
        resolution != '240' &&
        resolution != 'D' &&
        resolution != 'W') {
      throw `Unsupported resolution: ${resolution}`;
    }

    let numericalResolution = 300; // default to 5 mins

    switch (resolution) {
      case '1':
        numericalResolution = 60;
        break;
      case '5':
        numericalResolution = 300;
        break;
      case '15':
        numericalResolution = 900;
        break;
      case '30':
        numericalResolution = 1800;
        break;
      case '60':
        numericalResolution = 3600;
        break;
      case '120':
        numericalResolution = 7200;
        break;
      case '240':
        numericalResolution = 14400;
        break;
      case 'D':
        numericalResolution = 86400;
        break;
      case 'W':
        numericalResolution = 604800;
        break;
    }

    startDateTimestamp = startDateTimestamp - (startDateTimestamp % numericalResolution);

    const pairArray = symbolInfo.name.split('-');
    const address = `/api/stats/tradesarray?base=${pairArray[0]}&rel=${pairArray[1]}&starttime=${startDateTimestamp}&endtime=${endDateTimestamp}&timescale=${numericalResolution}`;
    const that = this;

    httpGet(address, (result) => {
      response.writeHead(200, defaultResponseHeader);
      response.write(JSON.stringify(convertDataToUDFFormat(result)));
      response.end();
    });
  }

  try {
    if (action === '/config') {
      this.sendConfig(response);
    } else if (action === '/symbols' && !!query['symbol']) {
      this.sendSymbolInfo(query['symbol'], response);
    } else if (action === '/search') {
      this.sendSymbolSearchResults(query['query'], query['type'], query['exchange'], query['limit'], response);
    } else if (action === '/history') {
      this.sendSymbolHistory(query['symbol'], query['from'], query['to'], query['resolution'], response);
    } else if (action === '/quotes') {
      // this.sendQuotes(query['symbols'], response);
    } else if (action === '/marks') {
      // this.sendMarks(response);
    } else if (action === '/timescale_marks') {
      // this.sendTimescaleMarks(response);
    } else {
      console.log('request ', action);

      if (action.indexOf('/public') > -1) {
        filePath = '.' + action;
      } else {
        filePath = './public/' + action;
      }

      if (action.indexOf('/assets') > -1) {
        filePath = './public' + action;
      }

      if (action === '/') {
        filePath = './public/index.html';
      }

      const extname = String(path.extname(filePath)).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.svg': 'application/image/svg+xml'
      };
      let contentType = 'text/html';

      contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(filePath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            response.writeHead(200, { 'Content-Type': contentType });
            response.end('wrong request', 'utf-8');
            /*fs.readFile('./404.html', function(error, content) {
                response.writeHead(200, { 'Content-Type': contentType });
                response.end('wrong request', 'utf-8');
            });*/
          } else {
            response.writeHead(500);
            response.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
            response.end();
          }
        } else {
          response.setHeader('Access-Control-Allow-Origin', '*');
          response.writeHead(200, { 'Content-Type': contentType });
          response.end(content);
        }
      });
    }
  } catch (error) {
    this.sendError(error, response);
  }
}

//  Usage:
//    /config
//    /symbols?symbol=A
//    /search?query=B&limit=10
//    /history?symbol=C&from=DATE&resolution=E

const firstPort = config.feedAPIPort;

const getFreePort = (callback) => {
  const port = firstPort;
  const server = http.createServer();

  server.listen(port, (err) => {
    server.once('close', () => {
      callback(port);
    });
    server.close();
  });

  server.on('error', (err) => {
    getFreePort(callback);
  });
}

getFreePort((port) => {
  if (config.https) {
    http.createServer(options, (request, response) => {
      const uri = url.parse(request.url, true);
      const action = uri.pathname;
      new RequestProcessor(action, uri.query, response);
    }).listen(port);
  } else {
    // non ssl
    http.createServer((request, response) => {
      const uri = url.parse(request.url, true);
      const action = uri.pathname;
      new RequestProcessor(action, uri.query, response);
    }).listen(port);
  }

  console.log(`Datafeed running at\n => http://${config.ip}:${firstPort}/\nCTRL + C to shutdown`);
});