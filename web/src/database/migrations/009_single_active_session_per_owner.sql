-- Empêche un même utilisateur de posséder plusieurs sessions non détruites.
--
-- Le contrôle existe aussi dans server.js pour fournir un message lisible,
-- mais cette contrainte PostgreSQL est la dernière barrière contre :
--   - deux clics / deux onglets concurrents ;
--   - plusieurs processus Node ;
--   - un futur déploiement avec plusieurs réplicas.
--
-- Une session partagée créée par un autre utilisateur reste accessible :
-- seule la propriété (created_by_user_id) est concernée.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_creator_unique
  ON sessions (tenant_id, created_by_user_id)
  WHERE
    created_by_user_id IS NOT NULL
    AND status <> 'destroyed';