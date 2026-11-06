<template>
  <footer class="w-full bg-white">
    <div class="max-w-7xl mx-auto px-6 py-20">
      <!-- Top Grid -->
      <div class="grid grid-cols-1 md:grid-cols-5 gap-12">
        <!-- Brand -->
        <div class="md:col-span-2">
          <!-- Logo -->
          <div class="mb-4">
            <!-- Replace with your actual logo -->
            <img
              src="/src/assets/images/new-logo.jpeg"
              alt="Credmate"
              class="h-10"
            />
          </div>

          <!-- Description -->
          <p class="text-gray-600 max-w-sm leading-relaxed">
            Nigeria's trusted digital lending platform. Get instant loans with
            competitive rates and flexible repayment terms.
          </p>
        </div>

        <!-- Products -->
        <div>
          <h4 class="font-semibold text-gray-900 mb-5">Products</h4>
          <ul class="space-y-3 text-gray-600">
            <li><a href="#" class="hover:text-pink-600">Personal Loans</a></li>
            <li><a href="#" class="hover:text-pink-600">Business Loans</a></li>
            <li><a href="#" class="hover:text-pink-600">Proof of Fund</a></li>
            <li><a href="#" class="hover:text-pink-600">Asset Financing</a></li>
            <li><a href="#" class="hover:text-pink-600">Invoice Financing</a></li>
          </ul>
        </div>

        <!-- Company -->
        <div>
          <h4 class="font-semibold text-gray-900 mb-5">Company</h4>
          <ul class="space-y-3 text-gray-600">
            <li><a href="#" class="hover:text-pink-600">About Us</a></li>
            <li><a href="#" class="hover:text-pink-600">Careers</a></li>
            <li><a href="#" class="hover:text-pink-600">Blog</a></li>
          </ul>
        </div>

        <!-- Support -->
        <div>
          <h4 class="font-semibold text-gray-900 mb-5">Support</h4>
          <ul class="space-y-3 text-gray-600">
            <li><a href="#" class="hover:text-pink-600">Help Center</a></li>
            <li><a href="#" class="hover:text-pink-600">Contact Us</a></li>
            <li><a href="#" class="hover:text-pink-600">FAQs</a></li>
            <li><a href="#" class="hover:text-pink-600">Privacy Policy</a></li>
            <li><a href="#" class="hover:text-pink-600">Terms of Service</a></li>
          </ul>
        </div>
      </div>

      <!-- Divider -->
      <div class="border-t border-gray-200 my-12"></div>

      <!-- Contact Row -->
      <div class="flex flex-col md:flex-row md:items-center md:gap-16 gap-6">
        <!-- Phone -->
        <div class="flex items-center gap-3 text-gray-900 font-semibold">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 text-purple-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.128a11.042 11.042 0 005.516 5.516l1.128-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
          <span>0700-CREDMATE</span>
        </div>

        <!-- Email -->
        <div class="flex items-center gap-3 text-gray-900 font-semibold">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 text-purple-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <span>support@getcredmate.co</span>
        </div>
      </div>

      <!-- Bottom Divider -->
      <div class="border-t border-gray-200 my-10"></div>

      <!-- Copyright -->
      <p class="text-sm text-gray-500">
        © 2026 Credmate Technology Limited. All rights reserved.
      </p>
    </div>
  </footer>
</template>

<script setup>
// No logic needed for static footer
</script>
