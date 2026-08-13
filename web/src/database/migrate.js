const fs = require('fs');
const path = require('path');

const database = require('./database');

const migrationsDirectory = path.join(
  __dirname,
  'migrations'
);

/**
 * Crée la table qui mémorise les migrations
 * déjà exécutées.
 */
async function ensureMigrationsTable() {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Retourne la liste des migrations déjà appliquées.
 */
async function getAppliedMigrations() {
  const result = await database.query(`
    SELECT name
    FROM schema_migrations
    ORDER BY name
  `);

  return new Set(
    result.rows.map((row) => row.name)
  );
}

/**
 * Exécute les migrations SQL non encore appliquées.
 */
async function migrate() {
  if (!fs.existsSync(migrationsDirectory)) {
    throw new Error(
      `Dossier de migrations introuvable : ${migrationsDirectory}`
    );
  }

  await ensureMigrationsTable();

  const appliedMigrations =
    await getAppliedMigrations();

  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) =>
      fileName.endsWith('.sql')
    )
    .sort();

  if (migrationFiles.length === 0) {
    console.log(
      'Aucune migration SQL trouvée.'
    );

    return;
  }

  for (const fileName of migrationFiles) {
    if (appliedMigrations.has(fileName)) {
      console.log(
        `Migration déjà appliquée : ${fileName}`
      );

      continue;
    }

    const filePath = path.join(
      migrationsDirectory,
      fileName
    );

    const sql = fs
      .readFileSync(
        filePath,
        'utf8'
      )
      .replace(/^\uFEFF/, '');

    console.log(
      `Application de la migration : ${fileName}`
    );

    

    const client = await database.getClient();

    try {
      await client.query('BEGIN');

     await client.query(sql);

      await client.query(
        `
          INSERT INTO schema_migrations (
            name
          )
          VALUES ($1)
        `,
        [fileName]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log(
      `Migration appliquée : ${fileName}`
    );
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log(
        'Toutes les migrations sont terminées.'
      );
    })
    .catch((error) => {
      console.error(
        'Erreur pendant les migrations :',
        error.message
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await database.close();
    });
}

module.exports = {
  migrate,
};
