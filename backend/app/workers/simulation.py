"""批量仿真 worker（ARQ）。

启动：

.. code-block:: bash

    cd backend && uv run arq app.workers.simulation.WorkerSettings

worker 做的事很少：**从库里取任务 → 跑仿真 → 把结果写回库里**。
物理计算是 CPU 密集的，放到线程里跑，别堵住事件循环。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.db import SessionLocal
from app.services import simulation_service, simulator

logger = logging.getLogger(__name__)


async def run_simulation(ctx: dict[str, Any], job_id: str) -> None:
    """跑一个批量仿真任务。

    任务的状态流转：``queued → running → succeeded | failed``。
    出错时把原因写进 ``error``——失败也要留痕，不能悄悄消失。
    """
    session = SessionLocal()
    try:
        job = simulation_service.get_job(session, job_id)
        if job is None:
            logger.warning("仿真任务不存在：%s", job_id)
            return

        simulation_service.mark_running(session, job_id)

        try:
            params = simulator.SimulationParams.from_mapping(job.params)
            runs = await asyncio.to_thread(simulator.run_sweep, job.scene, params, job.sweep)
        except Exception as exc:  # noqa: BLE001 —— 失败原因要写进库里
            logger.exception("仿真任务失败：%s", job_id)
            simulation_service.mark_finished(
                session, job_id, simulation_service.JOB_FAILED, str(exc)
            )
            return

        for run in runs:
            simulation_service.record_run(
                session,
                job_id,
                int(run["index"]),
                run["params"],
                run,
                int(run["durationMs"]),
            )
            simulation_service.mark_progress(session, job_id, int(run["index"]) + 1)

        simulation_service.mark_finished(session, job_id, simulation_service.JOB_SUCCEEDED)
    finally:
        session.close()


class WorkerSettings:
    """ARQ worker 的配置。

    入口就是 ``uv run arq app.workers.simulation.WorkerSettings``——
    ARQ 读这个类上的属性（名字与 ``arq.worker.Worker`` 的参数一一对应）。
    """

    functions = [run_simulation]
    redis_settings = simulation_service.redis_settings()
    queue_name = simulation_service.queue_name()
    # 一次只跑一个任务：物理是 CPU 密集的，并发跑只会互相抢核
    max_jobs = 1
    job_timeout = 600
    keep_result = 3600
