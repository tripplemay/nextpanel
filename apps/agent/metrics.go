package main

import (
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type Metrics struct {
	CPU       float64
	Mem       float64
	Disk      float64
	NetworkIn uint64
	NetworkOut uint64
}

func collectMetrics() (*Metrics, error) {
	cpuPcts, err := cpu.Percent(0, false)
	if err != nil || len(cpuPcts) == 0 {
		return nil, err
	}

	memStat, err := mem.VirtualMemory()
	if err != nil {
		return nil, err
	}

	diskStat, err := disk.Usage("/")
	if err != nil {
		return nil, err
	}

	netStats, err := net.IOCounters(false)
	if err != nil {
		return nil, err
	}

	var netIn, netOut uint64
	if len(netStats) > 0 {
		netIn = netStats[0].BytesRecv
		netOut = netStats[0].BytesSent
	}

	return &Metrics{
		CPU:        cpuPcts[0],
		Mem:        memStat.UsedPercent,
		Disk:       diskStat.UsedPercent,
		NetworkIn:  netIn,
		NetworkOut: netOut,
	}, nil
}
