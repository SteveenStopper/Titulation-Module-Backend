const { z } = require("zod");
const svc = require("../services/complexivoService");
const prisma = require("../../prisma/client");
const { requireModality } = require("../middlewares/requireModality");

async function myAttendance(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional(), courseId: z.coerce.number().int().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() });
    const q = schema.parse(req.query || {});
    const id_user = req.user?.sub; if (!id_user) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const data = await svc.listMyAttendance({ id_user, ...q });
    res.json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function addAttendance(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional(), courseId: z.coerce.number().int(), date: z.string().datetime(), present: z.boolean() });
    const body = schema.parse(req.body || {});
    const id_user = req.user?.sub; if (!id_user) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const data = await svc.addAttendance({ id_user, ...body });
    res.status(201).json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function listCourses(req, res, next) { try { const schema=z.object({academicPeriodId:z.coerce.number().int().optional()}); const q=schema.parse(req.query||{}); const data=await svc.listCourses(q); res.json(data);} catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }
async function listCourseTeachers(req, res, next) { try { const schema=z.object({courseId:z.coerce.number().int(), academicPeriodId:z.coerce.number().int().optional()}); const p=schema.parse({courseId:req.params.courseId, academicPeriodId:req.query.academicPeriodId}); const data=await svc.listCourseTeachers(p); res.json(data);} catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }
async function listVeedores(req, res, next) { try { const schema=z.object({careerId:z.coerce.number().int().optional(), academicPeriodId:z.coerce.number().int().optional()}); const q=schema.parse(req.query||{}); const data=await svc.listVeedores(q); res.json(data);} catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }

module.exports = { myAttendance, addAttendance, listCourses, listCourseTeachers, listVeedores };

// POST /complexivo/veedores/assign  { teacherId, careerId, academicPeriodId? }
async function assignVeedor(req, res, next) {
  try {
    const schema = z.object({ teacherId: z.coerce.number().int(), careerId: z.coerce.number().int(), academicPeriodId: z.coerce.number().int().optional() });
    const { teacherId, careerId, academicPeriodId } = schema.parse(req.body || {});
    // período activo
    let id_ap = Number.isFinite(Number(academicPeriodId)) ? Number(academicPeriodId) : undefined;
    if (!Number.isFinite(id_ap)) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }
    // upsert por período + carrera + docente
    const existing = await prisma.veedor_assignments.findFirst({ where: { id_academic_periods: Number(id_ap), id_career: Number(careerId), id_user: Number(teacherId) }, select: { id: true } });
    let saved;
    if (existing) {
      saved = existing;
    } else {
      saved = await prisma.veedor_assignments.create({ data: { id_academic_periods: Number(id_ap), id_career: Number(careerId), id_user: Number(teacherId) }, select: { id: true } });
    }
    // Notificar docente asignado
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({ id_user: Number(teacherId), type: 'complexivo_veedor_asignado', title: 'Asignado como Veedor', message: `Has sido asignado como veedor para la carrera ${Number(careerId)}`, entity_type: 'veedor_assignment', entity_id: Number(saved?.id || 0) });
    } catch (_) { /* no bloquear */ }
    res.status(201).json({ ok: true, id: Number(saved?.id || 0) });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

module.exports.assignVeedor = assignVeedor;

// PUT /complexivo/veedores/set  { careerId, teacherIds: number[], academicPeriodId? }
async function setVeedores(req, res, next) {
  try {
    const schema = z.object({ careerId: z.coerce.number().int(), teacherIds: z.array(z.coerce.number().int()).default([]), academicPeriodId: z.coerce.number().int().optional() });
    const { careerId, teacherIds, academicPeriodId } = schema.parse(req.body || {});

    // período activo (obligatorio) y no permitir guardar en períodos pasados
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const activeId = per?.id_academic_periods;
    if (!Number.isFinite(Number(activeId))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }

    if (Number.isFinite(Number(academicPeriodId)) && Number(academicPeriodId) !== Number(activeId)) {
      const e = new Error('Solo se permite guardar en el período activo');
      e.status = 400;
      throw e;
    }

    const id_ap = Number(activeId);
    const uniqueTeacherIds = Array.from(new Set((teacherIds || []).map(Number))).filter(x => Number.isFinite(x));

    // Reemplazar: borrar los que ya no están
    await prisma.veedor_assignments.deleteMany({
      where: {
        id_academic_periods: Number(id_ap),
        id_career: Number(careerId),
        ...(uniqueTeacherIds.length ? { id_user: { notIn: uniqueTeacherIds } } : {}),
      }
    });

    // Insertar faltantes
    if (uniqueTeacherIds.length) {
      const existing = await prisma.veedor_assignments.findMany({
        where: { id_academic_periods: Number(id_ap), id_career: Number(careerId), id_user: { in: uniqueTeacherIds } },
        select: { id_user: true }
      });
      const existingSet = new Set(existing.map(x => Number(x.id_user)));
      const toCreate = uniqueTeacherIds.filter(id => !existingSet.has(Number(id)));
      for (const teacherId of toCreate) {
        await prisma.veedor_assignments.create({ data: { id_academic_periods: Number(id_ap), id_career: Number(careerId), id_user: Number(teacherId) } });
        // Notificar docente asignado (no bloquear)
        try {
          const notifications = require('../services/notificationsService');
          await notifications.create({ id_user: Number(teacherId), type: 'complexivo_veedor_asignado', title: 'Asignado como Veedor', message: `Has sido asignado como veedor para la carrera ${Number(careerId)}`, entity_type: 'veedor_assignment', entity_id: 0 });
        } catch (_) { /* no bloquear */ }
      }
    } else {
      // Si se envía vacío, eliminar todos los veedores de la carrera en el período activo
      await prisma.veedor_assignments.deleteMany({ where: { id_academic_periods: Number(id_ap), id_career: Number(careerId) } });
    }

    res.json({ ok: true });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

module.exports.setVeedores = setVeedores;
