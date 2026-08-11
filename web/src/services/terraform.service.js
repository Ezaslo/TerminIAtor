const {
  spawn,
  spawnSync,
} = require('child_process');

const config = require('../config/env');

/**
 * Construit les variables d'environnement utilisees par Terraform.
 *
 * @param {object} extraEnvironment Variables supplementaires.
 * @returns {object}
 */
function buildTerraformEnvironment(
  extraEnvironment = {}
) {
  return {
    ...process.env,
    ...extraEnvironment,
  };
}

/**
 * Resout le dossier dans lequel Terraform doit etre execute.
 *
 * workingDirectory est le nom utilise par Privalyse.
 * cwd reste accepte pour compatibilite.
 *
 * @param {object} options Options d'execution.
 * @returns {string}
 */
function resolveWorkingDirectory(
  options = {}
) {
  return (
    options.workingDirectory ||
    options.cwd ||
    config.terraform.directory
  );
}

/**
 * Execute une commande Terraform.
 *
 * @param {string[]} argumentsList Arguments Terraform.
 * @param {object} options Options d'execution.
 * @returns {Promise<object>}
 */
function runTerraform(
  argumentsList,
  options = {}
) {
  return new Promise((resolve, reject) => {
    const terraformBinary =
      config.terraform.binary;

    const workingDirectory =
      resolveWorkingDirectory(options);

    const extraEnvironment =
      options.extraEnvironment || {};

    const onLog =
      typeof options.onLog === 'function'
        ? options.onLog
        : () => {};

    onLog(
      `terraform ${argumentsList.join(' ')}`,
      'info'
    );

    if (!terraformBinary) {
      reject(
        new Error(
          'Terraform introuvable. ' +
          'Definis TERRAFORM_BIN ou ajoute Terraform au PATH.'
        )
      );

      return;
    }

    const child = spawn(
      terraformBinary,
      argumentsList,
      {
        cwd: workingDirectory,
        shell: false,
        env: buildTerraformEnvironment(
          extraEnvironment
        ),
      }
    );

    child.on('error', (error) => {
      reject(error);
    });

    child.stdout.on('data', (data) => {
      data
        .toString()
        .split('\n')
        .forEach((line) => {
          if (line.trim() !== '') {
            onLog(line, 'terraform');
          }
        });
    });

    child.stderr.on('data', (data) => {
      data
        .toString()
        .split('\n')
        .forEach((line) => {
          if (line.trim() !== '') {
            onLog(line, 'error');
          }
        });
    });

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        onLog(
          `terraform ${argumentsList[0]} termine (code 0)`,
          'success'
        );

        resolve({
          exitCode,
        });

        return;
      }

      onLog(
        `terraform ${argumentsList[0]} sorti avec le code ${exitCode}`,
        'error'
      );

      reject(
        new Error(
          `Terraform exited with code ${exitCode}`
        )
      );
    });
  });
}

/**
 * Lit un output Terraform au format texte.
 *
 * @param {string} outputName Nom de l'output Terraform.
 * @param {object} options Options d'execution.
 * @returns {object}
 */
function outputRaw(
  outputName,
  options = {}
) {
  const terraformBinary =
    config.terraform.binary;

  const workingDirectory =
    resolveWorkingDirectory(options);

  if (!terraformBinary) {
    return {
      status: 1,
      stdout: '',
      stderr: 'Terraform introuvable',
    };
  }

  try {
    return spawnSync(
      terraformBinary,
      [
        'output',
        '-raw',
        outputName,
      ],
      {
        cwd: workingDirectory,
        encoding: 'utf8',
        shell: false,
        env: buildTerraformEnvironment(
          options.extraEnvironment || {}
        ),
      }
    );
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      stderr: error.message,
    };
  }
}

module.exports = {
  runTerraform,
  outputRaw,
};