"use client";

import React, { useState } from "react";

interface NGO {
  id: string;
  name: string;
  registrationNumber: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  district: string;
  state: string;
  status: "active" | "inactive" | "pending";
  joinedDate: string;
  totalRequests: number;
  fulfilledRequests: number;
  pendingRequests: number;
}

interface GoodsRequest {
  id: string;
  ngoId: string;
  ngoName: string;
  itemType: string;
  quantity: number;
  unit: string;
  urgency: "low" | "medium" | "high" | "critical";
  requestDate: string;
  requiredBy: string;
  description: string;
  status: "pending" | "approved" | "rejected";
}

// Mock data for NGOs
const MOCK_NGOS: NGO[] = [
  {
    id: "1",
    name: "Food For All Mumbai",
    registrationNumber: "NGO-MUM-2020-001",
    contactPerson: "Rajesh Kumar",
    email: "contact@foodforall-mumbai.org",
    phone: "+91 98765 43210",
    address: "123 Main Street, Andheri East",
    district: "Mumbai",
    state: "Maharashtra",
    status: "active",
    joinedDate: "2020-03-15",
    totalRequests: 145,
    fulfilledRequests: 132,
    pendingRequests: 13,
  },
  {
    id: "2",
    name: "Hope Foundation Delhi",
    registrationNumber: "NGO-DEL-2019-045",
    contactPerson: "Priya Sharma",
    email: "info@hopefoundation-delhi.org",
    phone: "+91 98765 43211",
    address: "456 Connaught Place",
    district: "Delhi",
    state: "Delhi",
    status: "active",
    joinedDate: "2019-08-22",
    totalRequests: 198,
    fulfilledRequests: 185,
    pendingRequests: 13,
  },
  {
    id: "3",
    name: "Care India Bangalore",
    registrationNumber: "NGO-BLR-2021-023",
    contactPerson: "Amit Patel",
    email: "contact@careindia-blr.org",
    phone: "+91 98765 43212",
    address: "789 MG Road",
    district: "Bangalore",
    state: "Karnataka",
    status: "active",
    joinedDate: "2021-01-10",
    totalRequests: 87,
    fulfilledRequests: 79,
    pendingRequests: 8,
  },
  {
    id: "4",
    name: "Hunger Free Pune",
    registrationNumber: "NGO-PUN-2020-067",
    contactPerson: "Sneha Deshmukh",
    email: "info@hungerfree-pune.org",
    phone: "+91 98765 43213",
    address: "321 FC Road",
    district: "Pune",
    state: "Maharashtra",
    status: "pending",
    joinedDate: "2024-10-28",
    totalRequests: 5,
    fulfilledRequests: 0,
    pendingRequests: 5,
  },
];

// Mock goods requests from NGOs
const MOCK_GOODS_REQUESTS: GoodsRequest[] = [
  {
    id: "req-1",
    ngoId: "1",
    ngoName: "Food For All Mumbai",
    itemType: "Rice",
    quantity: 500,
    unit: "kg",
    urgency: "high",
    requestDate: "2024-11-01",
    requiredBy: "2024-11-05",
    description:
      "Emergency supply needed for flood-affected families in Andheri area",
    status: "pending",
  },
  {
    id: "req-2",
    ngoId: "2",
    ngoName: "Hope Foundation Delhi",
    itemType: "Wheat Flour",
    quantity: 300,
    unit: "kg",
    urgency: "medium",
    requestDate: "2024-10-30",
    requiredBy: "2024-11-08",
    description: "Monthly distribution for community kitchen program",
    status: "pending",
  },
  {
    id: "req-3",
    ngoId: "3",
    ngoName: "Care India Bangalore",
    itemType: "Lentils (Dal)",
    quantity: 200,
    unit: "kg",
    urgency: "critical",
    requestDate: "2024-10-28",
    requiredBy: "2024-11-02",
    description: "Urgent requirement for orphanage - existing stock depleted",
    status: "pending",
  },
  {
    id: "req-4",
    ngoId: "1",
    ngoName: "Food For All Mumbai",
    itemType: "Cooking Oil",
    quantity: 100,
    unit: "liters",
    urgency: "low",
    requestDate: "2024-10-27",
    requiredBy: "2024-11-10",
    description: "Regular monthly supply for distribution center",
    status: "pending",
  },
];

export default function NGODashboard() {
  const [ngos] = useState<NGO[]>(MOCK_NGOS);
  const [selectedNGO, setSelectedNGO] = useState<NGO | null>(null);
  const [incomingRequests, setIncomingRequests] =
    useState<GoodsRequest[]>(MOCK_GOODS_REQUESTS);
  const [selectedRequest, setSelectedRequest] = useState<GoodsRequest | null>(
    null
  );
  const [isRequestsModalOpen, setIsRequestsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Form state for new NGO
  const [newNGO, setNewNGO] = useState({
    name: "",
    registrationNumber: "",
    contactPerson: "",
    email: "",
    phone: "",
    address: "",
    district: "",
    state: "",
  });

  // Filter NGOs based on search and status
  const filteredNGOs = ngos.filter((ngo) => {
    const matchesSearch =
      ngo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ngo.district.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ngo.registrationNumber.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || ngo.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Calculate statistics
  const totalNGOs = ngos.length;
  const activeNGOs = ngos.filter((ngo) => ngo.status === "active").length;
  const pendingNGOs = ngos.filter((ngo) => ngo.status === "pending").length;
  const incomingRequestsCount = incomingRequests.length;

  const handleAddNGO = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle add NGO logic here
    console.log("Adding NGO:", newNGO);
    setIsAddModalOpen(false);
    setNewNGO({
      name: "",
      registrationNumber: "",
      contactPerson: "",
      email: "",
      phone: "",
      address: "",
      district: "",
      state: "",
    });
  };

  const handleAcceptRequest = (requestId: string) => {
    const request = incomingRequests.find((req) => req.id === requestId);
    if (request) {
      // Update request status to approved
      setIncomingRequests(
        incomingRequests.map((req) =>
          req.id === requestId ? { ...req, status: "approved" as const } : req
        )
      );
      // Close modals
      setIsRequestsModalOpen(false);
      setSelectedRequest(null);
      // In a real app, this would call an API to approve the request
      console.log("Approved request:", request);
    }
  };

  const handleRejectRequest = (requestId: string) => {
    const request = incomingRequests.find((req) => req.id === requestId);
    if (request) {
      // Update request status to rejected
      setIncomingRequests(
        incomingRequests.map((req) =>
          req.id === requestId ? { ...req, status: "rejected" as const } : req
        )
      );
      // Close modals
      setIsRequestsModalOpen(false);
      setSelectedRequest(null);
      // In a real app, this would call an API to reject the request
      console.log("Rejected request:", request);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded bg-purple-600 dark:bg-purple-500">
                <svg
                  className="h-5 w-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  NGO Management
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Partner Organizations Dashboard
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Notification Bell for Incoming Requests */}
              <button
                onClick={() => setIsRequestsModalOpen(true)}
                className="relative rounded-full p-2 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                title="View incoming requests"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {incomingRequestsCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
                    {incomingRequestsCount}
                  </span>
                )}
              </button>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                India Region
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Statistics Cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Total NGOs
                </p>
                <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {totalNGOs}
                </p>
              </div>
              <div className="rounded-full bg-purple-100 p-3 dark:bg-purple-950">
                <svg
                  className="h-6 w-6 text-purple-600 dark:text-purple-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Active NGOs
                </p>
                <p className="mt-1 text-2xl font-semibold text-green-600 dark:text-green-400">
                  {activeNGOs}
                </p>
              </div>
              <div className="rounded-full bg-green-100 p-3 dark:bg-green-950">
                <svg
                  className="h-6 w-6 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Pending Approval
                </p>
                <p className="mt-1 text-2xl font-semibold text-orange-600 dark:text-orange-400">
                  {pendingNGOs}
                </p>
              </div>
              <div className="rounded-full bg-orange-100 p-3 dark:bg-orange-950">
                <svg
                  className="h-6 w-6 text-orange-600 dark:text-orange-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Pending Goods Requests
                </p>
                <p className="mt-1 text-2xl font-semibold text-blue-600 dark:text-blue-400">
                  {incomingRequestsCount}
                </p>
              </div>
              <div className="rounded-full bg-blue-100 p-3 dark:bg-blue-950">
                <svg
                  className="h-6 w-6 text-blue-600 dark:text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Filters and Actions */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search NGOs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-10 pr-4 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex rounded-md border border-zinc-300 dark:border-zinc-700">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-2 text-sm transition-colors ${
                  viewMode === "grid"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-2 text-sm transition-colors border-l border-zinc-300 dark:border-zinc-700 ${
                  viewMode === "list"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Add NGO Button */}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add New NGO
          </button>
        </div>

        {/* NGO Grid/List */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredNGOs.map((ngo) => (
              <div
                key={ngo.id}
                onClick={() => setSelectedNGO(ngo)}
                className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-5 transition-all hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                {/* NGO Header */}
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {ngo.name}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ngo.registrationNumber}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      ngo.status === "active"
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                        : ngo.status === "pending"
                          ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {ngo.status}
                  </span>
                </div>

                {/* Location */}
                <div className="mb-3 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span>
                    {ngo.district}, {ngo.state}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Total Requests
                    </p>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {ngo.totalRequests}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Fulfilled
                    </p>
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {ngo.fulfilledRequests}
                    </p>
                  </div>
                </div>

                {/* Contact Person */}
                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Contact Person
                  </p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {ngo.contactPerson}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    NGO Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Requests
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredNGOs.map((ngo) => (
                  <tr
                    key={ngo.id}
                    className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {ngo.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {ngo.registrationNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                      {ngo.district}, {ngo.state}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100">
                        {ngo.contactPerson}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {ngo.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          ngo.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                            : ngo.status === "pending"
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
                              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {ngo.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                      {ngo.totalRequests}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedNGO(ngo)}
                        className="text-sm font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {filteredNGOs.length === 0 && (
          <div className="flex min-h-[400px] items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-zinc-400 dark:text-zinc-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <h3 className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No NGOs found
              </h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Try adjusting your search or filters
              </p>
            </div>
          </div>
        )}
      </main>

      {/* NGO Detail Modal */}
      {selectedNGO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {selectedNGO.name}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {selectedNGO.registrationNumber}
                </p>
              </div>
              <button
                onClick={() => setSelectedNGO(null)}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {/* Status Badge */}
              <div className="mb-6">
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                    selectedNGO.status === "active"
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                      : selectedNGO.status === "pending"
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {selectedNGO.status.toUpperCase()}
                </span>
              </div>

              {/* Statistics Grid */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Total Requests
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedNGO.totalRequests}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Fulfilled
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-green-600 dark:text-green-400">
                    {selectedNGO.fulfilledRequests}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Pending
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-orange-600 dark:text-orange-400">
                    {selectedNGO.pendingRequests}
                  </p>
                </div>
              </div>

              {/* Contact Information */}
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Contact Information
                </h3>
                <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-start gap-3">
                    <svg
                      className="mt-0.5 h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Contact Person
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {selectedNGO.contactPerson}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg
                      className="mt-0.5 h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Email
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {selectedNGO.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg
                      className="mt-0.5 h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Phone
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {selectedNGO.phone}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg
                      className="mt-0.5 h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Address
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {selectedNGO.address}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {selectedNGO.district}, {selectedNGO.state}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Requests Section */}
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Recent Food Requests
                </h3>
                <div className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-800">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Emergency Food Supply
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Requested: Oct 28, 2024
                      </p>
                    </div>
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
                      Fulfilled
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-800">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Weekly Ration Distribution
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Requested: Oct 30, 2024
                      </p>
                    </div>
                    <span className="inline-flex rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                      Pending
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Community Kitchen Supply
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Requested: Nov 1, 2024
                      </p>
                    </div>
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                      Processing
                    </span>
                  </div>
                </div>
              </div>

              {/* Additional Info */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Additional Information
                </h3>
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      Joined Date
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {new Date(selectedNGO.joinedDate).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        }
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <button
                onClick={() => setSelectedNGO(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600">
                Edit NGO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add NGO Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Add New NGO
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleAddNGO} className="p-6">
              <div className="space-y-4">
                {/* NGO Name */}
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    NGO Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={newNGO.name}
                    onChange={(e) =>
                      setNewNGO({ ...newNGO, name: e.target.value })
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="Enter NGO name"
                  />
                </div>

                {/* Registration Number */}
                <div>
                  <label
                    htmlFor="registrationNumber"
                    className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Registration Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="registrationNumber"
                    required
                    value={newNGO.registrationNumber}
                    onChange={(e) =>
                      setNewNGO({
                        ...newNGO,
                        registrationNumber: e.target.value,
                      })
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="e.g., NGO-MUM-2024-001"
                  />
                </div>

                {/* Contact Person */}
                <div>
                  <label
                    htmlFor="contactPerson"
                    className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Contact Person <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="contactPerson"
                    required
                    value={newNGO.contactPerson}
                    onChange={(e) =>
                      setNewNGO({ ...newNGO, contactPerson: e.target.value })
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="Enter contact person name"
                  />
                </div>

                {/* Email and Phone */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="email"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      id="email"
                      required
                      value={newNGO.email}
                      onChange={(e) =>
                        setNewNGO({ ...newNGO, email: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="phone"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      required
                      value={newNGO.phone}
                      onChange={(e) =>
                        setNewNGO({ ...newNGO, phone: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="+91 98765 43210"
                    />
                  </div>
                </div>

                {/* Address */}
                <div>
                  <label
                    htmlFor="address"
                    className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Address <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="address"
                    required
                    rows={3}
                    value={newNGO.address}
                    onChange={(e) =>
                      setNewNGO({ ...newNGO, address: e.target.value })
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="Enter full address"
                  />
                </div>

                {/* District and State */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="district"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      District <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="district"
                      required
                      value={newNGO.district}
                      onChange={(e) =>
                        setNewNGO({ ...newNGO, district: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Enter district"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="state"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      State <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="state"
                      required
                      value={newNGO.state}
                      onChange={(e) =>
                        setNewNGO({ ...newNGO, state: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Enter state"
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600"
                >
                  Add NGO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Incoming Requests Modal */}
      {isRequestsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white dark:bg-zinc-900">
            <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
                  Goods Requests from NGOs
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Review and manage food/goods requests from partner NGOs
                </p>
              </div>
              <button
                onClick={() => setIsRequestsModalOpen(false)}
                className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {incomingRequestsCount === 0 ? (
                <div className="py-12 text-center">
                  <svg
                    className="mx-auto h-16 w-16 text-zinc-300 dark:text-zinc-700"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                  <h3 className="mt-4 text-lg font-medium text-zinc-900 dark:text-white">
                    No Pending Requests
                  </h3>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    All goods requests have been processed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                                request.urgency === "critical"
                                  ? "bg-red-100 dark:bg-red-950"
                                  : request.urgency === "high"
                                    ? "bg-orange-100 dark:bg-orange-950"
                                    : request.urgency === "medium"
                                      ? "bg-yellow-100 dark:bg-yellow-950"
                                      : "bg-blue-100 dark:bg-blue-950"
                              }`}
                            >
                              <svg
                                className={`h-5 w-5 ${
                                  request.urgency === "critical"
                                    ? "text-red-600 dark:text-red-400"
                                    : request.urgency === "high"
                                      ? "text-orange-600 dark:text-orange-400"
                                      : request.urgency === "medium"
                                        ? "text-yellow-600 dark:text-yellow-400"
                                        : "text-blue-600 dark:text-blue-400"
                                }`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                />
                              </svg>
                            </div>
                            <div className="flex-1">
                              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                                {request.itemType} - {request.quantity}{" "}
                                {request.unit}
                              </h3>
                              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                Requested by {request.ngoName}
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-medium uppercase ${
                                request.urgency === "critical"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                                  : request.urgency === "high"
                                    ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
                                    : request.urgency === "medium"
                                      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
                                      : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              }`}
                            >
                              {request.urgency}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex items-center gap-2 text-sm">
                              <svg
                                className="h-4 w-4 text-zinc-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                />
                              </svg>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                <span className="font-medium">Item:</span>{" "}
                                {request.itemType}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <svg
                                className="h-4 w-4 text-zinc-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                                />
                              </svg>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                <span className="font-medium">Quantity:</span>{" "}
                                {request.quantity} {request.unit}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <svg
                                className="h-4 w-4 text-zinc-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                <span className="font-medium">
                                  Required by:
                                </span>{" "}
                                {new Date(
                                  request.requiredBy
                                ).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 rounded-lg bg-white p-3 text-sm dark:bg-zinc-900">
                            <p className="font-medium text-zinc-700 dark:text-zinc-300">
                              Description:
                            </p>
                            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                              {request.description}
                            </p>
                          </div>

                          <div className="mt-3 flex items-center gap-2 text-sm">
                            <svg
                              className="h-4 w-4 text-zinc-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            <span className="text-zinc-600 dark:text-zinc-400">
                              Requested on{" "}
                              {new Date(request.requestDate).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                }
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => {
                            setIsRequestsModalOpen(false);
                            setSelectedRequest(request);
                          }}
                          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => handleAcceptRequest(request.id)}
                          className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                        >
                          ✓ Accept
                        </button>
                        <button
                          onClick={() => handleRejectRequest(request.id)}
                          className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Request Details Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white dark:bg-zinc-900">
            <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
                Request Details
              </h2>
              <button
                onClick={() => setSelectedRequest(null)}
                className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {/* Request Header */}
              <div className="mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full ${
                      selectedRequest.urgency === "critical"
                        ? "bg-red-100 dark:bg-red-950"
                        : selectedRequest.urgency === "high"
                          ? "bg-orange-100 dark:bg-orange-950"
                          : selectedRequest.urgency === "medium"
                            ? "bg-yellow-100 dark:bg-yellow-950"
                            : "bg-blue-100 dark:bg-blue-950"
                    }`}
                  >
                    <svg
                      className={`h-6 w-6 ${
                        selectedRequest.urgency === "critical"
                          ? "text-red-600 dark:text-red-400"
                          : selectedRequest.urgency === "high"
                            ? "text-orange-600 dark:text-orange-400"
                            : selectedRequest.urgency === "medium"
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-blue-600 dark:text-blue-400"
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-zinc-900 dark:text-white">
                      {selectedRequest.itemType}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Requested by {selectedRequest.ngoName}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase ${
                      selectedRequest.urgency === "critical"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                        : selectedRequest.urgency === "high"
                          ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
                          : selectedRequest.urgency === "medium"
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                    }`}
                  >
                    {selectedRequest.urgency} Priority
                  </span>
                </div>
              </div>

              {/* Request Details Grid */}
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    QUANTITY REQUESTED
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-white">
                    {selectedRequest.quantity} {selectedRequest.unit}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    REQUIRED BY
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-white">
                    {new Date(selectedRequest.requiredBy).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                      }
                    )}
                  </p>
                </div>
              </div>

              {/* Description */}
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Description
                </h3>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {selectedRequest.description}
                  </p>
                </div>
              </div>

              {/* Request Timeline */}
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Timeline
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <svg
                      className="h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Request Submitted
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {new Date(
                          selectedRequest.requestDate
                        ).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <svg
                      className="h-5 w-5 text-zinc-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Required By
                      </p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {new Date(
                          selectedRequest.requiredBy
                        ).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    handleAcceptRequest(selectedRequest.id);
                  }}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-green-700"
                >
                  ✓ Approve Request
                </button>
                <button
                  onClick={() => {
                    handleRejectRequest(selectedRequest.id);
                  }}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
                >
                  ✕ Reject Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
