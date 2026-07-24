const { Pool } = require('pg');

const config = require('../config/env');

let pool = null;

/**
 * Retourne le pool de connexions PostgreSQL.
 *
 * Le pool évite d'ouvrir une nouvelle connexion
 * à chaque requête HTTP.
 *
 * @returns {Pool}
 */
function getPool() {
  if (!config.database.url) {
    throw new Error(
      'DATABASE_URL est manquante dans le fichier .env'
    );
  }

  if (!pool) {
    const poolOptions = {
      connectionString: config.database.url,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    if (config.database.ssl) {
      poolOptions.ssl = {
        rejectUnauthorized: true,
      };
    }

    pool = new Pool(poolOptions);

    pool.on('error', (error) => {
      console.error(
        'Erreur PostgreSQL inattendue :',
        error.message
      );
    });
  }

  return pool;
}

/**
 * Exécute une requête SQL.
 *
 * Exemple :
 * query('SELECT * FROM sessions WHERE id = $1', [id])
 *
 * @param {string} sql Requête SQL.
 * @param {Array} parameters Paramètres sécurisés.
 * @returns {Promise<object>}
 */
function query(
  sql,
  parameters = []
) {
  if (parameters.length === 0) {
    return getPool().query(sql);
  }

  return getPool().query(
    sql,
    parameters
  );
}

/**
 * Vérifie que PostgreSQL répond.
 *
 * @returns {Promise<object>}
 */
async function testConnection() {
  const result = await query(
    'SELECT NOW() AS current_time'
  );

  return result.rows[0];
}

/**
 * Ferme les connexions PostgreSQL.
 */
async function close() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
/**
 * Retourne un client PostgreSQL dédié.
 *
 * Le client doit être libéré avec client.release().
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
function getClient() {
  return getPool().connect();
}

module.exports = {
  getPool,
  getClient,
  query,
  testConnection,
  close,
};