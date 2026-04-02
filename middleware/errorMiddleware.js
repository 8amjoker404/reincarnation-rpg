const notFound = (req, res, next) => {
  return res.status(404).json({
    success: false,
    message: "Route not found"
  });
};

const errorHandler = (err, req, res, next) => {
  console.error("ERROR:", err);

  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
};

module.exports = {
  notFound,
  errorHandler
};