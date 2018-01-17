/*
	This file is a node.js module.

	This is an implementation of UDF-compatible datafeed wrapper for poloniex
	Some algorithms may be icorrect because it's rather an UDF implementation sample
	then a proper datafeed implementation.

	https://codeforgeek.com/2015/01/nodejs-mysql-tutorial/
*/

var http = require("http"),
url = require("url"),
symbolsDatabase = require("./symbols_database"),
https = require("https"); // propose to remove this from both polo and coinbase
const config = require('./config');

var datafeedHost = config.feedSourceIP;
var datafeedPort = config.feedSourcePort;
var defaultResponseHeader = {"Content-Type": "text/plain", 'Access-Control-Allow-Origin': '*'};

function httpGet(path, callback) {
  var options = {
  host: datafeedHost,
  port: datafeedPort,
  path: path
  };

  onDataCallback = function(response) {
    var result = '';

    response.on('data', function(chunk) {
      result += chunk
    });

    response.on('end', function() {
      callback(result)
    });
  }

  var req = http.request(options, onDataCallback);
  req.on('socket', function(socket) {
    socket.setTimeout(35000);
    socket.on('timeout', function() { 
      console.log('timeout');
      req.abort();
    });
  });

  req.on('error', function(e) {
    console.log('Problem with request: ' + e.message);
    //callback('');
  });

  req.end();
}

// propose to remove this
function httpsGet(exchange, path, callback) {
  var options = {
    host: feedSourceIP + ':' + feedSourcePort,
    path: path,
    headers: {  'User-Agent': 'NodeJS server/1.0' }
  };
  //console.log('Path utilized: ' + path);

  onDataCallback = function(response) {
    var result = '';

    response.on('data', function(chunk) {
      result += chunk
    });

    response.on('end', function() {
      callback(result)
    });
  }

  var req = https.request(options, onDataCallback);
  req.on('socket', function(socket) {
    socket.setTimeout(35000);
    socket.on('timeout', function() {
      console.log('timeout');
      req.abort();
    });
  });

  req.on('error', function(e) {
    console.log('Problem with request: ' + e.message);
    //callback('');
  });

  req.end();
}

function convertDataToUDFFormat(data) { // propose to alter this
  var result = {
    t: [], c: [], o: [], h: [], l: [], v: [],
    s: []
  };

try {
  var lines = JSON.parse(data);
} catch(e) {
  console.log('malformed request', data);
  return '{ "error": "malformed request: ' + data + '"}';
}

if (lines.length == 0) {
  result.s = "no_data";
} else {
  for (var i = 0; i < lines.length; i++) {
    var items = lines[i];
    result.s = "ok";

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
  this.sendError = function(error, response) {
    response.writeHead(200, defaultResponseHeader);
    response.write("{\"s\":\"error\",\"errmsg\":\"" + error + "\"}");
    response.end();
    console.log(error);
  }

  this.sendConfig = function(response) {
    var config = {
      supports_search: true,
      supports_group_request: false,
      supports_marks: false,
      supports_timescale_marks: false,
      exchanges: [
        {value: "", name: "All Exchanges", desc: ""},
        {value: "BARTERDEX", name: "BarterDEX", desc: "BarterDEX"},
      ],
      symbolsTypes: [
        {name: "All types", value: ""},
        {name: "Barterdex", value: "barterdex"},
        {name: "Index", value: "index"},
      ],
      supportedResolutions: [ "1", "5", "15", "30", "60", "120", "240", "D", "W"],
    };

    response.writeHead(200, defaultResponseHeader);
    response.write(JSON.stringify(config));
    response.end();
  }

  this.sendSymbolSearchResults = function(query, type, exchange, maxRecords, response) {
    if (!maxRecords) {
      throw "wrong_query";
    }

    var result = symbolsDatabase.search(query, type, exchange, maxRecords);

    response.writeHead(200, defaultResponseHeader);
    response.write(JSON.stringify(result));
    response.end();
  }

  this.sendSymbolInfo = function(symbolName, response) {
    var symbolInfo = symbolsDatabase.symbolInfo(symbolName);

    if (symbolInfo == null) {
      throw "unknown_symbol " + symbolName;
    }

    var address = "";
    var exchange = "";

    var separator = '-';
    var pairArray = symbolInfo.name.split(separator);

    address = "/api/stats/tradesarray?base=" + pairArray[0] +
      "&rel=" + pairArray[1] +
      "&starttime=0&endtime=0&timescale=60";
    exchange = "barterdex";

    var that = this;

    //console.log(datafeedHost + address);

    httpGet(address, function(result) {
      var resultAll;
      try {
        resultAll = JSON.parse(result);
      } catch(e) {}
      var lastPrice = "";

      lastPrice = '' + resultAll[0][1];

      //	BEWARE: this `pricescale` parameter computation algorithm is wrong and works
      //	for symbols with 10-based minimal movement value only
      var pricescale = lastPrice.indexOf('.') > 0
        ? Math.pow(10, lastPrice.split('.')[1].length)
        : 10;

      var info = {
        "name": symbolInfo.name,
        "exchange-traded": symbolInfo.exchange,
        "exchange-listed": symbolInfo.exchange,
        "timezone": "UTC",
        "minmov": 1,
        "minmov2": 0,
        "pricescale": pricescale,
        "pointvalue": 1,
        "session": "24x7",
        "has_intraday": true,
        "has_no_volume": false,
        "ticker": symbolInfo.name.toUpperCase(),
        "description": symbolInfo.description.length > 0 ? symbolInfo.description : symbolInfo.name,
        "type": symbolInfo.type,
        "supported_resolutions" : [ "1", "5", "15", "30", "60", "120", "240", "D", "W"]
      };

      response.writeHead(200, defaultResponseHeader);
      response.write(JSON.stringify(info));
      response.end();
    });
  }

  this.sendSymbolHistory = function(symbol, startDateTimestamp, endDateTimestamp, resolution, response) {
    var symbolInfo = symbolsDatabase.symbolInfo(symbol);

    if (symbolInfo == null) {
      throw "unknown_symbol";
    }

    if (resolution != "1" && resolution != "5" && resolution != "15" && resolution != "30" && resolution != "60" && resolution != "120" && resolution != "240" && resolution != "D" && resolution != "W") {
      throw "Unsupported resolution: " + resolution;
    }

    var numericalResolution = 300; // default to 5 mins
    switch (resolution) {
      case "1": numericalResolution = 60; break;
      case "5": numericalResolution = 300; break;
      case "15": numericalResolution = 900; break;
      case "30": numericalResolution = 1800; break;
      case "60": numericalResolution = 3600; break;
      case "120": numericalResolution = 7200; break;
      case "240": numericalResolution = 14400; break;
      case "D": numericalResolution = 86400; break;
      case "W": numericalResolution = 604800; break;
    }

    //console.log(startDateTimestamp);
    startDateTimestamp = startDateTimestamp - (startDateTimestamp % numericalResolution);
    //console.log("\n new: "+startDateTimestamp);

    var separator = '-';
    var pairArray = symbolInfo.name.split(separator);

    var address = "/api/stats/tradesarray?base=" + pairArray[0] +
      "&rel=" + pairArray[1] +
      "&starttime=" + startDateTimestamp +
      "&endtime=" + endDateTimestamp +
      "&timescale=" + numericalResolution;
    //console.log("Requesting " + address);

    var that = this;

    httpGet(address, function(result) {
      response.writeHead(200, defaultResponseHeader);
      response.write(JSON.stringify(convertDataToUDFFormat(result)));
      response.end();
    });
  }

  try {
    if (action == "/config") {
      this.sendConfig(response);
    } else if (action == "/symbols" && !!query["symbol"]) {
      this.sendSymbolInfo(query["symbol"], response);
    } else if (action == "/search") {
      this.sendSymbolSearchResults(query["query"], query["type"], query["exchange"], query["limit"], response);
    } else if (action == "/history") {
      this.sendSymbolHistory(query["symbol"], query["from"], query["to"], query["resolution"], response);
    } else if (action == "/quotes") {
      //this.sendQuotes(query["symbols"], response);
    } else if (action == "/marks") {
      //this.sendMarks(response);
    } else if (action == "/timescale_marks") {
      //this.sendTimescaleMarks(response);
    }
  } catch (error) {
    this.sendError(error, response);
  }
}

//	Usage:
//		/config
//		/symbols?symbol=A
//		/search?query=B&limit=10
//		/history?symbol=C&from=DATE&resolution=E

var firstPort = config.feedAPIPort;
function getFreePort(callback) {
  var port = firstPort;
  firstPort++;

  var server = http.createServer();

  server.listen(port, function (err) {
    server.once('close', function () {
      callback(port);
    });
    server.close();
  });

  server.on('error', function (err) {
    getFreePort(callback);
  });
}

getFreePort(function(port) {
  http.createServer(function(request, response) {
    var uri = url.parse(request.url, true);
    var action = uri.pathname;
    new RequestProcessor(action, uri.query, response);
  }).listen(port);

  console.log(`Datafeed running at\n => http://${config.ip}:${firstPort}/\nCTRL + C to shutdown`);
});