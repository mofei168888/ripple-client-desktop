var util = require('util'),
    events = require('events'),
    rewriter = require('./jsonrewriter');

/**
 * Class listening to Ripple network state and updating models.
 *
 * This class handles all incoming events by the network and updates
 * the appropriate local models.
 */
var Model = function ()
{
  events.EventEmitter.call(this);
};
util.inherits(Model, events.EventEmitter);

Model.prototype.init = function ()
{
  var $scope = this.app.$scope;

  $scope.balance = "0";

  $scope.currencies_all = require('../data/currencies');
  $scope.currencies = $scope.currencies_all.slice(1);
};

Model.prototype.setApp = function (app)
{
  this.app = app;
};

/**
 * Setup listeners for identity state.
 *
 * Causes the initialization of account model data.
 */
Model.prototype.listenId = function (id)
{
  id.on('accountload', this.handleAccountLoad.bind(this));
};

Model.prototype.handleAccountLoad = function (e)
{
  var remote = this.app.net.remote;
  remote.request_ripple_lines_get(e.account)
    .on('success', this.handleRippleLines.bind(this)).request();
  remote.request_wallet_accounts(e.secret)
    .on('success', this.handleAccounts.bind(this)).request();

  remote.on('net_account', this.handleAccountEvent.bind(this));

  var $scope = this.app.$scope;
  $scope.address = e.account;
};

Model.prototype.handleRippleLines = function (data)
{
  var $scope = this.app.$scope;
  $scope.$apply(function ()
  {
    $scope.lines={};
    for (var n=0, l=data.lines.length; n<l; n++)
    {
      var line = data.lines[n];

      // XXX: Not sure this is correct, the server should send standard amount
      //      json that I can feed to Amount.from_json.
      line.limit = ripple.Amount.from_json({value: line.limit, currency: line.currency});
      line.limit_peer = ripple.Amount.from_json({value: line.limit_peer, currency: line.currency});

      $scope.lines[line.account+line.currency] = line;
    }
    console.log('Lines updated:', $scope.lines);
  });
};

Model.prototype.handleAccounts = function (data)
{
  var self = this;
  var remote = this.app.net.remote;
  var $scope = this.app.$scope;
  $scope.$apply(function () {
    $scope.balance = data.accounts[0].Balance;

    remote.request_account_tx(data.accounts[0].Account, "0", "999999")
      .on('success', self.handleAccountTx.bind(self, data.accounts[0].Account)).request();
  });
};

Model.prototype.handleAccountTx = function (account, data)
{
  var self = this;

  var $scope = this.app.$scope;
  $scope.$apply(function () {
    $scope.history = [];
    if (data.transactions) {
      var transactions = data.transactions.forEach(function (e) {
        self._processTxn(e.tx, e.meta);
      });
    }
  });
};

Model.prototype.handleAccountEvent = function (e)
{
  this._processTxn(e.transaction, e.meta);
  var $scope = this.app.$scope;
  $scope.$digest();
};

/**
 * Process a transaction and add it to the history table.
 */
Model.prototype._processTxn = function (tx, meta)
{
  var $scope = this.app.$scope;

  var account = this.app.id.account;

  var processedTxn = rewriter.processTxn(tx, meta, account);

  if (processedTxn) {
    $scope.history.unshift(processedTxn);

    // If the transaction had an effect on our Ripple lines
    if (processedTxn.rippleState) this._updateLines(processedTxn);
  }
};

/*
account: "rHMq44aXmd9wEYHK84VyiZyx8SP6VbpzNV"
balance: "0"
currency: "USD"
limit: "2000"
limit_peer: "0"
quality_in: 0
quality_out: 0
 */
Model.prototype._updateLines = function(txn)
{
  var $scope = this.app.$scope;

  var index = txn.counterparty + txn.currency,
      line = {};

  line.currency = txn.currency;

  if (line.currency === "INR") console.log("TXN", txn);

  if (txn.tx_type === "Payment") {
    line.balance = txn.balance;
  } else if (txn.tx_type === "TrustSet") {
    line.limit = txn.trust_out;
    line.limit_peer = txn.trust_in;
  } else return;

  $scope.lines[index] = $.extend($scope.lines[index], line);
}

exports.Model = Model;
