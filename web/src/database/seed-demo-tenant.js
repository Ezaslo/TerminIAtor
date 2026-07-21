const database = require('./database');

const tenantRepository = require(
  '../repositories/tenant.repository'
);

async function seedDemoTenant() {
  const slug = 'terminiator-demo';

  const existingTenant =
    await tenantRepository.findTenantBySlug(
      slug
    );

  if (existingTenant) {
    console.log(
      'Tenant déjà présent :',
      existingTenant
    );

    return existingTenant;
  }

  const tenant =
    await tenantRepository.createTenant({
      name: 'TerminIAtor Demo',
      slug,
    });

  console.log(
    'Tenant créé :',
    tenant
  );

  return tenant;
}

seedDemoTenant()
  .catch((error) => {
    console.error(
      'Erreur pendant la création du tenant :',
      error.message
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await database.close();
  });