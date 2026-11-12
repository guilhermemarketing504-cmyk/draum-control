-- Fuso padrão do banco: America/Belem (UTC−3). Garante datas corretas mesmo via pooler.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Belem');
exception when others then
  raise notice 'Não foi possível definir o fuso do banco (%). Defina manualmente se necessário.', sqlerrm;
end $$;
