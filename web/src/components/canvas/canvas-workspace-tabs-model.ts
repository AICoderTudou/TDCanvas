export function openCanvasTab(projectIds: string[], projectId: string) {
    return projectIds.includes(projectId) ? projectIds : [...projectIds, projectId];
}

export function closeCanvasTab(projectIds: string[], projectId: string, activeProjectId: string) {
    const index = projectIds.indexOf(projectId);
    const nextIds = projectIds.filter((id) => id !== projectId);
    if (projectId !== activeProjectId) return { projectIds: nextIds, nextProjectId: activeProjectId };
    return { projectIds: nextIds, nextProjectId: nextIds[Math.min(index, nextIds.length - 1)] };
}
