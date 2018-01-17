import React from 'react';
import Store from '../../store';
import Select from 'react-select';
import config from '../../config';
import { coins } from '../../coins.js';

class Main extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      base: 'KMD',
      rel: 'MNZ',
      coins: coins,
    };
    this.updateInput = this.updateInput.bind(this);
    this.createTView = this.createTView.bind(this);
    this.reinitTradingView = this.reinitTradingView.bind(this);
    this.datafeed = null;
    this.widget = null;
  }

  componentDidMount() {
    this.createTView(config.defaultPair);
  }

  reinitTradingView() {
    const _feed = this.widget.options.datafeed._barsPulseUpdater._subscribers;
    this.datafeed.unsubscribeBars(Object.keys(_feed)[0]);
    this.widget.remove();  
    this.createTView(`${this.state.base}-${this.state.rel}`);
  }

  createTView(pair) {
    this.datafeed = new Datafeeds.UDFCompatibleDatafeed(config.datafeedURL);
    this.widget = new TradingView.widget({
      fullscreen: true,
      symbol: pair,
      //debug: true,
      interval: 15,
      container_id: 'tv_chart_container',
      //  BEWARE: no trailing slash is expected in feed URL
      datafeed: this.datafeed,
      library_path: config.dev ? '/assets/charting_library/' : '/public/charting_library/',
      locale: "en",
      //  Regression Trend-related functionality is not implemented yet, so it's hidden for a while
      drawings_access: { type: 'black', tools: [ { name: 'Regression Trend' } ] },
      disabled_features: [
        'use_localstorage_for_settings',
        'volume_force_overlay'
      ],
      charts_storage_url: 'http://saveload.tradingview.com',
      overrides: {
        'mainSeriesProperties.style': 1,
        'symbolWatermarkProperties.color': '#944',
      },
      time_frames: [
        { text: '5m', resolution: '5' },
        { text: '15m', resolution: '15' },
        { text: '30m', resolution: '30' },
        { text: '60m', resolution: '60' },
        { text: '120m', resolution: '120' },
        { text: '240m', resolution: '240' },
        { text: '1D', resolution: 'D' },
        { text: '1W', resolution: 'W' }
      ],
      client_id: 'example.com',
      user_id: '',
    });  
  }

  updateInput(e, type) {
    if (e &&
        e.value) {
      this.setState({
        [type === 'rel' ? 'rel' : 'base']: e.value,
      });
    }
  }

  renderCoinIcon(coin) {
    return (
      <span>
        <img
          width="30"
          height="30"
          src={ `/${config.dev ? 'assets' : 'public'}/images/${coin.value.toLowerCase()}.png`} />
        <span className="table-coin-name">{ coin.label }</span>
      </span>
    );
  }

  render() {
    return (
      <div className="main-container">
        <nav className="navbar navbar-default navbar-static-top">
          <div className="container-fluid">
            <div className="navbar-header">
              { /*<button type="button" className="navbar-toggle">
                <span className="sr-only">Toggle navigation</span>
                <span className="icon-bar"></span>
                <span className="icon-bar"></span>
                <span className="icon-bar"></span>
                </button> */ }
              <div className="navbar-brand">BarterDEX Charts</div>
            </div>
            <div className="collapse navbar-collapse" id="navbar-brand-centered">
              <ul className="nav navbar-nav">
              </ul>
              <ul className="nav navbar-nav navbar-right">
              </ul>
            </div>
          </div>
        </nav>
        <div className="pair-selectors">
          <span className="pair-label">Pair</span>
          <Select
            className="pair"
            name="base"
            value={ this.state.base }
            onChange={ (event) => this.updateInput(event, 'base') }
            optionRenderer={ this.renderCoinIcon }
            valueRenderer={ this.renderCoinIcon }
            options={ this.state.coins } />
          <Select
            className="pair last"
            name="selectedPair"
            value={ this.state.rel }
            onChange={ (event) => this.updateInput(event, 'rel') }
            optionRenderer={ this.renderCoinIcon }
            valueRenderer={ this.renderCoinIcon }
            options={ this.state.coins } />
          <button
            className="btn btn-primary"
            onClick={ this.reinitTradingView }
            disabled={ this.state.base === this.state.rel }>Update</button>
        </div>
        <div id="tv_chart_container"></div>
      </div>
    );
  }
}

export default Main;