import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { NodeDeployService } from './node-deploy.service';
import { XrayTestService } from './xray-test/xray-test.service';
import { AuditService } from '../audit/audit.service';

describe('NodesController SSE ownership checks', () => {
  const nodesService = {
    findOne: jest.fn(),
  } as unknown as NodesService;
  const nodeDeploy = {
    deployStream: jest.fn(() => of({ data: { done: true } })),
    undeployStream: jest.fn(() => of({ data: { done: true } })),
  } as unknown as NodeDeployService;
  const xrayTest = {} as XrayTestService;
  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const controller = new NodesController(
    nodesService,
    nodeDeploy,
    xrayTest,
    auditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (nodesService.findOne as jest.Mock).mockResolvedValue({ id: 'node-1' });
  });

  it('checks ownership before opening a deploy stream', async () => {
    const stream = await controller.deployStream('node-1', { id: 'user-1' });

    expect(nodesService.findOne).toHaveBeenCalledWith('node-1', 'user-1');
    expect(nodeDeploy.deployStream).toHaveBeenCalledWith(
      'node-1',
      'user-1',
      expect.any(String),
    );
    expect(stream).toBeDefined();
  });

  it('rejects a cross-user deploy stream before SSH work or audit logging', async () => {
    (nodesService.findOne as jest.Mock).mockRejectedValue(
      new NotFoundException('Node node-1 not found'),
    );

    await expect(
      controller.deployStream('node-1', { id: 'other-user' }),
    ).rejects.toThrow(NotFoundException);

    expect(nodeDeploy.deployStream).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('checks ownership before opening a delete stream', async () => {
    await controller.deleteStream('node-1', { id: 'user-1' });

    expect(nodesService.findOne).toHaveBeenCalledWith('node-1', 'user-1');
    expect(nodeDeploy.undeployStream).toHaveBeenCalledWith(
      'node-1',
      'user-1',
      expect.any(String),
    );
  });
});
