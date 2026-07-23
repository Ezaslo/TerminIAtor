function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route introuvable'
  });
}

function errorHandler(err, req, res, next) {
  console.error(err);

  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : 500;

  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    error:
      statusCode === 500
        ? 'Une erreur interne est survenue'
        : err.message || 'Une erreur est survenue',
    ...(isProduction
      ? {}
      : {
          details: err.stack
        })
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};