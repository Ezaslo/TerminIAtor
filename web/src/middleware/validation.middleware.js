function validateLogin(request, response, next) {
  const email =
    typeof request.body?.email === 'string'
      ? request.body.email.trim().toLowerCase()
      : '';

  const password =
    typeof request.body?.password === 'string'
      ? request.body.password
      : '';

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !password) {
    return response.status(400).json({
      error: 'L’email et le mot de passe sont obligatoires.'
    });
  }

  if (!emailPattern.test(email)) {
    return response.status(400).json({
      error: 'Adresse email invalide.'
    });
  }

  request.body.email = email;
  request.body.password = password;

  return next();
}

module.exports = {
  validateLogin
};