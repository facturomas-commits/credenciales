# Prueba de carga TEADEM con Grafana k6

El script `teadem.k6.js` usa las rutas reales de la web/API y **no modifica registros**. Hace un login inicial y prueba listado, ficha por DNI, estado de credencial, provincias, ciudades y pastores. Las fotos se pueden habilitar aparte. Nunca llama a editar, unificar, generar ni imprimir.

## Ejecutar en PowerShell

Con k6 instalado y desde la carpeta `teadem-web`:

```powershell
$env:BASE_URL = "http://127.0.0.1:3251"
$env:EMAIL = "TU_USUARIO"
$clave = Read-Host "Contraseña de prueba" -AsSecureString
$env:PASSWORD = [System.Net.NetworkCredential]::new("", $clave).Password
$env:VUS = "3"
try {
  k6 run .\load-tests\teadem.k6.js
} finally {
  Remove-Item Env:PASSWORD -ErrorAction SilentlyContinue
  $clave = $null
}
```

`BASE_URL` es la raíz del servicio, sin `/admin/credenciales` al final:

- Backend directo en este servidor: `http://127.0.0.1:3251`.
- Para incluir el proxy Node/Express, usar la URL de la web, por ejemplo `http://TU_SERVIDOR:3301` o su dominio HTTPS.
- `127.0.0.1` siempre identifica la máquina donde se ejecuta k6. No sirve para alcanzar este servidor desde otra computadora ni desde Grafana Cloud.

## Carga y datos

Carga predeterminada: 10 s hasta 1 usuario virtual, 10 s hasta 3, 30 s estables y 10 s de bajada. Cada usuario realiza las consultas en secuencia, espera 1 s entre el panel y la búsqueda, y 2 s al terminar el ciclo. VU no equivale a solicitudes por segundo.

El login ocurre **una vez** en `setup`: todos los VU comparten ese token. Esta prueba mide principalmente las consultas, no la capacidad del login concurrente ni el renderizado del navegador. Usar una cuenta de prueba con permisos de consulta adecuados y vigencia del token suficiente para la duración elegida.

Si no se indica `DNIS`, toma hasta 10 DNI del listado actual. Un listado vacío corta la prueba antes de iniciar la carga.

Opciones adicionales:

```powershell
$env:DNIS = "DNI_REAL_1,DNI_REAL_2" # opcional; reemplazar por DNI existentes
$env:PROVINCIA_ID = "ID_REAL"      # opcional; se descubre desde la primera persona
$env:FECHA_DESDE = "2026-11-01"    # opcional; filtro del listado
$env:FECHA_HASTA = "2026-11-30"    # opcional
$env:FOTOS = "1"                  # opcional; aumenta la transferencia de datos
$env:VUS = "5"                    # subir gradualmente después de la primera prueba
$env:DURACION = "1m"              # tiempo de carga estable, además de las rampas
```

No se imprimen contraseñas, tokens, nombres ni DNI. Las métricas usan etiquetas genéricas por endpoint, sin etiquetas URL con DNI. No activar depuración HTTP ni compartir archivos de salida que puedan contener información sensible.

## Qué revisar

Umbrales iniciales orientativos (ajustar al objetivo real del sistema):

- Menos de 1 % de solicitudes fallidas (`http_req_failed`).
- Más de 99 % de verificaciones correctas (`checks`), incluido contenido JSON válido.
- Percentil 95 global por debajo de 2 s.
- Percentil 95 del listado por debajo de 3 s.

k6 termina con código distinto de cero cuando incumple un umbral. Un error de red, login, DNI inexistente, token vencido o falta de permisos también puede producir fallos: no todos indican saturación. `http_req_duration` mide la petición HTTP, no exclusivamente el tiempo SQL.

Ante un fallo, el script registra hasta tres avisos por endpoint y usuario virtual con `endpoint`, `http_status`, `error_code`, `duracion_ms` y `datos_validos`. No imprime URL, DNI, token ni cuerpo. Esto permite distinguir un HTTP 500 de un 401, 502 o fallo de transporte (status 0). El catálogo de provincias también debe contener registros válidos: un 200 con arreglo vacío no aprueba la validación.

Las iteraciones interrumpidas al finalizar la rampa se informan aparte y no deben confundirse automáticamente con los errores HTTP. Comparar estado HTTP, horario del aviso y registro del backend antes de atribuir la causa.

Primero usar una copia de prueba o una ventana tranquila y 1–3 VU. No ejecutar estrés alto en producción mientras se imprimen credenciales o se editan datos. Observar CPU, memoria, Firebird y errores del backend a la vez.

Para Grafana Cloud se puede usar `k6 cloud run .\load-tests\teadem.k6.js` después de configurar la autenticación de k6 y un destino accesible desde el generador. El destino local no es accesible desde los generadores de Cloud. Los requisitos de conectividad y la inyección segura de variables/secretos deben configurarse en ese entorno; no subir credenciales al repositorio.
