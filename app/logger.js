/**
 * Logger estruturado em JSON para observabilidade com Loki/Grafana.
 *
 * Campos padrão:
 *   timestamp, level, message
 *
 * Campos contextuais comuns:
 *   method, path, statusCode, duration, username, userId, reason
 */

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

function log(level, message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...context,
    };
    // Envia como string JSON pura para stdout (Promtail coleta)
    process.stdout.write(JSON.stringify(entry) + '\n');
}

const logger = {
    info(message, context = {})  { log(LEVELS.INFO,  message, context); },
    warn(message, context = {})  { log(LEVELS.WARN,  message, context); },
    error(message, context = {}) { log(LEVELS.ERROR, message, context); },
};

module.exports = logger;
