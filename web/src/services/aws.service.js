const { spawnSync } = require('child_process');

const config = require('../config/env');

/**
 * Construit les variables d'environnement utilisées par AWS CLI.
 *
 * @returns {object}
 */
function buildAwsEnvironment() {
  const awsEnvironment = {
    ...process.env,
  };

  if (process.env.AWS_PROFILE) {
    awsEnvironment.AWS_PROFILE =
      process.env.AWS_PROFILE;
  }

  if (process.env.AWS_REGION) {
    awsEnvironment.AWS_REGION =
      process.env.AWS_REGION;

    awsEnvironment.AWS_DEFAULT_REGION =
      process.env.AWS_REGION;
  }

  return awsEnvironment;
}

/**
 * Exécute une commande AWS CLI.
 *
 * Exemple :
 * runAwsCli(['sts', 'get-caller-identity'])
 *
 * @param {string[]} argumentsList Arguments transmis à AWS CLI.
 * @param {object} options Options d'exécution.
 * @returns {object}
 */
function runAwsCli(
  argumentsList,
  options = {}
) {
  const workingDirectory =
    options.cwd ||
    config.terraform.directory;

  try {
    return spawnSync(
      'aws',
      argumentsList,
      {
        cwd: workingDirectory,
        encoding: 'utf8',
        shell: false,
        env: buildAwsEnvironment(),
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

/**
 * Lit la valeur d'un tag associé à une instance EC2.
 *
 * @param {string} instanceId Identifiant de l'instance EC2.
 * @param {string} tagKey Nom du tag recherché.
 * @param {object} options Options d'exécution.
 * @returns {string|null}
 */
function readEc2Tag(
  instanceId,
  tagKey,
  options = {}
) {
  const result = runAwsCli(
    [
      'ec2',
      'describe-tags',
      '--filters',
      `Name=resource-id,Values=${instanceId}`,
      `Name=key,Values=${tagKey}`,
      '--query',
      'Tags[0].Value',
      '--output',
      'text',
    ],
    options
  );

  if (result.status !== 0) {
    return null;
  }

  const value = (
    result.stdout || ''
  ).trim();

  if (!value || value === 'None') {
    return null;
  }

  return value;
}

module.exports = {
  runAwsCli,
  readEc2Tag,
};