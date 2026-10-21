-- Datos de PRUEBA para el Supabase local. Todo es inventado: ni las entidades,
-- ni los proyectos, ni las cotizaciones existen en el PMO real.
--
-- Usuarios (solo existen en tu stack local). No hay pantalla de login: el
-- middleware abre la sesión sola con el que diga .env.local.
--   admin@prueba.test    rol admin   → emite, anula, reenvía
--   auditor@prueba.test  rol auditor → ve todo en solo lectura
-- Contraseña de ambos: Prueba-XxflirQ3QawQ

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@prueba.test', 'Admin', 'Prueba', 'admin'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'auditor@prueba.test', 'Auditor', 'Prueba', 'auditor')
    ) as t(id, email, nombre, apellido, rol)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Prueba-XxflirQ3QawQ', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
    insert into public.perfiles (id, email, nombre, apellido, rol)
    values (u.id, u.email, u.nombre, u.apellido, u.rol);
  end loop;
end
$$;

-- Directorio fiscal de prueba. RUC y DV son INVENTADOS: para emitir contra
-- HKA demo hay que dar de alta una entidad real desde la pestaña (el alta
-- verifica con ConsultaRucDv; jamás se deduce un RUC).
insert into public.entidades_fiscales
  (id, nombre, siglas, tipo_ruc, ruc, dv, razon_social, direccion, codigo_ubicacion, provincia, distrito, corregimiento, correo, notas)
values
  ('10000000-0000-4000-a000-000000000001', 'MINISTERIO DE PRUEBA', 'MIPRU', '2', '0-000-0001', '00',
   'MINISTERIO DE PRUEBA', 'Calle Ficticia, Edificio Demo', '8-8-1', 'PANAMA', 'PANAMA', 'SAN FELIPE',
   'compras@prueba.test', 'Entidad inventada para el repo de facturación.'),
  ('10000000-0000-4000-a000-000000000002', 'INSTITUTO DE ENSAYO', 'INEN', '2', '0-000-0002', '00',
   'INSTITUTO DE ENSAYO', 'Avenida Demo', '8-8-1', 'PANAMA', 'PANAMA', 'SAN FELIPE',
   null, 'Entidad inventada para el repo de facturación.');

insert into public.entidades_fiscales_alias (entidad_id, alias) values
  ('10000000-0000-4000-a000-000000000001', 'MINISTERIO DE PRUEBA'),
  ('10000000-0000-4000-a000-000000000002', 'INSTITUTO DE ENSAYO');

insert into public.cotizaciones (id, numero, cliente_nombre, cliente_direccion, cliente_contacto_email, entidad_id) values
  ('20000000-0000-4000-a000-000000000001', 'EST9001', 'MINISTERIO DE PRUEBA', 'Calle Ficticia, Edificio Demo',
   'compras@prueba.test', '10000000-0000-4000-a000-000000000001'),
  ('20000000-0000-4000-a000-000000000002', 'EST9002', 'INSTITUTO DE ENSAYO', 'Avenida Demo',
   null, '10000000-0000-4000-a000-000000000002');

insert into public.cotizacion_items (cotizacion_id, orden, nombre, descripcion, precio_unitario, cantidad, itbms_exento, renglon_numero) values
  ('20000000-0000-4000-a000-000000000001', 0, 'Camisa polo bordada', 'Talla surtida, color azul', 18.50, 40, false, 1),
  ('20000000-0000-4000-a000-000000000001', 1, 'Gorra con logo', null, 6.25, 40, false, 2),
  ('20000000-0000-4000-a000-000000000002', 0, 'Licencia de software anual', 'Suscripción 12 meses', 240.00, 3, false, 1),
  ('20000000-0000-4000-a000-000000000002', 1, 'Capacitación', 'Servicio exento de prueba', 150.00, 1, true, 2);

insert into public.proyectos (id, nombre, cliente, numero_acto, numero_oc, cotizacion_id, entidad_id) values
  ('30000000-0000-4000-a000-000000000001', 'Uniformes de prueba', 'MINISTERIO DE PRUEBA',
   '2026-0-00-0-00-CL-000001', 'OC-0001', '20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001'),
  ('30000000-0000-4000-a000-000000000002', 'Licencias de ensayo', 'INSTITUTO DE ENSAYO',
   '2026-0-00-0-00-CL-000002', null, '20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002');
