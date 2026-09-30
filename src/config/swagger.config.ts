import swaggerJSDoc from 'swagger-jsdoc';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Game Arena API',
      version: '1.0.0',
      description: 'API RESTful y WebSocket Server para el juego multijugador de estrategia (Muros, Salas y Clasificación mundial)',
      contact: {
        name: 'Soporte Game Arena',
        email: 'anthony.moronta@triplecyber.com.do'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor Local de Desarrollo'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce tu token JWT en el formato: Bearer <token>'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin', 'superadmin', 'guest', 'banned'] },
            presenceStatus: { type: 'string', enum: ['online', 'offline', 'playing', 'idle'] },
            avatarUrl: { type: 'string' },
            hasUsernameSet: { type: 'boolean' }
          }
        },
        Report: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            reporterId: { type: 'string' },
            reportedUserId: { type: 'string' },
            category: { type: 'string', enum: ['cheating', 'harassment', 'inappropriate_username', 'other'] },
            details: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'reviewed', 'dismissed'] }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Estado de salud del servidor',
          tags: ['Health'],
          responses: {
            '200': { description: 'Servidor operando correctamente' }
          }
        }
      },
      '/api/auth/register': {
        post: {
          summary: 'Registro de nuevo usuario',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    username: { type: 'string' },
                    password: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Usuario registrado con éxito' }
          }
        }
      },
      '/api/auth/login': {
        post: {
          summary: 'Iniciar sesión con credenciales',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    login: { type: 'string', description: 'Email o username' },
                    password: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Login exitoso y retorno de JWT token' }
          }
        }
      },
      '/api/auth/guest': {
        post: {
          summary: 'Login como usuario Invitado (Guest)',
          tags: ['Auth'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string', example: 'Guest_1234' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Sesión de invitado creada con JWT token' }
          }
        }
      },
      '/api/auth/social': {
        post: {
          summary: 'Login Social con Google o Facebook',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string', enum: ['google', 'facebook'] },
                    token: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Login social verificado' }
          }
        }
      },
      '/api/auth/set-username': {
        post: {
          summary: 'Asignar username a perfil social recién creado',
          tags: ['Auth'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Username actualizado' }
          }
        }
      },
      '/api/users/me': {
        get: {
          summary: 'Obtener perfil del usuario autenticado',
          tags: ['Users'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Perfil de usuario y estadísticas' }
          }
        },
        put: {
          summary: 'Actualizar perfil y avatar',
          tags: ['Users'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string' },
                    avatarUrl: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Perfil actualizado' }
          }
        }
      },
      '/api/users/leaderboard': {
        get: {
          summary: 'Clasificación mundial Top 100 de jugadores',
          tags: ['Users'],
          responses: {
            '200': { description: 'Lista ordenada de mejores jugadores con Rango y Nivel' }
          }
        }
      },
      '/api/reports': {
        post: {
          summary: 'Crear un reporte sobre un usuario',
          tags: ['Reports'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reportedUserId: { type: 'string' },
                    category: { type: 'string', enum: ['cheating', 'harassment', 'inappropriate_username', 'other'] },
                    details: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Reporte creado' }
          }
        }
      },
      '/api/admin/users': {
        get: {
          summary: 'Listado paginado de usuarios (Solo Admin)',
          tags: ['Admin'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Lista paginada de usuarios' }
          }
        }
      },
      '/api/admin/reports': {
        get: {
          summary: 'Listado paginado de reportes del sistema (Solo Admin)',
          tags: ['Admin'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Reportes del sistema' }
          }
        }
      },
      '/api/admin/stats': {
        get: {
          summary: 'Métricas generales del sistema (Solo Admin)',
          tags: ['Admin'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Estadísticas del servidor' }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js']
};

export const swaggerSpec = swaggerJSDoc(options);
