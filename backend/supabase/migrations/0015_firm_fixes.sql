-- Huntington Bank's board answered on a re-check (its first check hit a
-- Workday 500), so it is polled. FNF, Berkadia, Howard Hughes and MAA stayed
-- unreadable at every address tried and stay off.
update firms set active = true, slug_verified = true where name = 'Huntington Bank';
