import { createClient } from 'redis';
import Utils from '../../common/utils.js';

/*
 * [MODULE_TYPES.in]: {
 *   load: 'function',
 *   unload: 'function',
 *   setContext: 'function',
 *   setCollector: 'function',
 * },
 *
 */

export default class InRedis {
  static type = "in";

  static _defaultCollector () {
    throw new Error('Collector not set');
  }

  constructor (context, config = {}) {
    this.type = InRedis.type;
    this.config = config;
    this.setContext(context);

    this.pubsub = null;
  }

  _validateConfig () {
    if (this.config == null) {
      throw new Error("config not set");
    }

    if (this.config.redis == null) {
      throw new Error("config.redis not set");
    }

    if (this.config.redis.host == null) {
      throw new Error("config.host not set");
    }

    if (this.config.redis.port == null) {
      throw new Error("config.port not set");
    }

    if (this.config.redis.inboundChannels == null || this.config.redis.inboundChannels.length == 0) {
      throw new Error("config.inboundChannels not set");
    }

    return true;
  }

  _onPubsubEvent(message, channel) {
    this.logger.trace('Received message on pubsub', { message });

    try {
      const event = JSON.parse(message);

      if (Utils.isEmpty(event)) return;

      this._collector(event);
    } catch (error) {
      this.logger.error(`Error processing message on [${channel}]: ${error}`);
    }
  }

  _subscribeToEvents() {
    if (this.pubsub == null) {
      throw new Error("pubsub not initialized");
    }

    return Promise.all(
      this.config.redis.inboundChannels.map((channel) => {
        return this.pubsub.subscribe(channel, this._onPubsubEvent.bind(this))
          .then(() => this.logger.info(`subscribed to: ${channel}`))
          .catch((error) => this.logger.error(`error subscribing to: ${channel}: ${error}`));
      })
    );
  }

  _onRedisError(error) {
    this.logger.error("Redis client failure", error);
  }

  async load () {
    if (this._validateConfig()) {
      const { password, host, port } = this.config.redis;
      const redisUrl = `redis://${password ? `:${password}@` : ''}${host}:${port}`;
      this.pubsub = createClient({
        url: redisUrl,
      });
      this.pubsub.on('error', this._onRedisError.bind(this));
      this.pubsub.on('ready', () => this.logger.info('Redis client is ready'));
      await this.pubsub.connect();
      await this._subscribeToEvents();
    }
  }

  async unload () {
    if (this.pubsub != null) {
      await this.pubsub.disconnect();
      this.pubsub = null;
    }

    this.setCollector(InRedis._defaultCollector);
    this.loaded = false;
    this.logger.info('InRedis unloaded');
  }

  setContext (context) {
    this.context = context;
    this.logger = context.getLogger();

    return context;
  }

  async setCollector (collector) {
    this._collector = collector;
  }
}
