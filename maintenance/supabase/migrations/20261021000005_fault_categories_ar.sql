-- Arabic display name for fault categories (the English name stays the key stored on tickets)
alter table fault_categories add column name_ar text check (name_ar is null or length(trim(name_ar)) between 2 and 60);

update fault_categories set name_ar = case name
  when 'Broken clasp' then 'قفل مكسور'
  when 'Broken chain' then 'سلسلة مقطوعة'
  when 'Missing stone' then 'فص مفقود'
  when 'Tarnish / discoloration' then 'تغير اللون / اسوداد'
  when 'Sizing' then 'تعديل المقاس'
  when 'Other' then 'أخرى'
end;
