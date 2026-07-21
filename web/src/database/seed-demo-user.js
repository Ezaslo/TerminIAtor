require('../config/env');

const database = require('./database');

const tenantRepository = require(
  '../repositories/tenant.repository'
);

const userRepository = require(
  '../repositories/user.repository'
);

const passwordService = require(
  '../services/password.service'
);

async function seedDemoUser() {
  const email = (
    process.env.DEMO_ADMIN_EMAIL || ''
  )
    .trim()
    .toLowerCase();

  const password =
    process.env.DEMO_ADMIN_PASSWORD || '';

  if (!email || !password) {
    throw new Error(
      'DEMO_ADMIN_EMAIL et DEMO_ADMIN_PASSWORD sont obligatoires dans .env'
    );
  }

  const existingUser =
    await userRepository.findUserByEmail(
      email
    );

  if (existingUser) {
    console.log(
      'Utilisateur deja present :',
      {
        id: existingUser.id,
        email: existingUser.email,
        role: existingUser.role,
        tenantId: existingUser.tenant_id,
      }
    );

    return existingUser;
  }

  const tenant =
    await tenantRepository.findTenantBySlug(
      'terminiator-demo'
    );

  if (!tenant) {
    throw new Error(
      'Le tenant terminiator-demo est introuvable. Lance d’abord seed-demo-tenant.js'
    );
  }

  const passwordHash =
    await passwordService.hashPassword(
      password
    );

  const user =
    await userRepository.createUser({
      tenantId: tenant.id,
      email,
      passwordHash,
      role: 'owner',
    });

  console.log(
    'Utilisateur cree :',
    user
  );

  return user;
}

seedDemoUser()
  .catch((error) => {
    console.error(
      'Erreur pendant la creation de l’utilisateur :',
      error.message
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await database.close();
  });