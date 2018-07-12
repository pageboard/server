const crypto = require('crypto');

const mailgunTokens = {};
const mailgunExpirey = 15 * 60 * 1000;
const mailgunHashType = 'sha256';
const mailgunSignatureEncoding = 'hex';

module.exports = function validateMailgun(config, timestamp, token, signature) {
	if (!config.api_key) {
		console.warn("Cannot do mailgun validation without api_key");
		return false;
	}
	var actual;
	var adjustedTimestamp = parseInt(timestamp, 10) * 1000;
	var fresh = (Math.abs(Date.now() - adjustedTimestamp) < mailgunExpirey);

	if (!fresh) {
		console.error('[mailgun] Stale Timestamp: this may be an attack');
		console.error('[mailgun] This is most likely the server time not synchronized with NTP\n');
		console.error('[mailgun] System Time: ' + new Date().toString());
		console.error('[mailgun] Mailgun Time: ' + new Date(adjustedTimestamp).toString(), timestamp);
		console.error('[mailgun] Delta: ' + (Date.now() - adjustedTimestamp));
		return false;
	}

	if (mailgunTokens[token]) {
		console.error('[mailgun] Replay Attack');
		return false;
	}

	mailgunTokens[token] = true;

	setTimeout(function () {
		delete mailgunTokens[token];
	}, mailgunExpirey + (5 * 1000));

	var computed = crypto.createHmac(mailgunHashType, config.api_key)
		.update(new Buffer(timestamp + token, 'utf-8'))
		.digest(mailgunSignatureEncoding);

	return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
};

