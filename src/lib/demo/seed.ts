/**
 * FICTIONAL DEMO DATA
 * Every person, address, phone number, email and Instagram handle below is
 * invented. Phone numbers use Ofcom's reserved drama range (07700 900xxx) and
 * emails use the reserved example.com domain.
 *
 * Dates are generated relative to "now" so the demo always looks current.
 */
import type { AppData } from "@/lib/types";
import { addDaysKey } from "@/lib/utils";

export const DEMO_DATA_VERSION = 3;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

export function createSeedData(): AppData {
  return {
    version: DEMO_DATA_VERSION,
    seededAt: new Date().toISOString(),
    enquiries: [
      {
        id: "enq_kitchen_crawley",
        customerName: "Hannah Whitfield",
        email: "hannah.whitfield@example.com",
        phone: "07700 900142",
        source: "email",
        title: "Kitchen renovation",
        description:
          "Looking to rip out our 1990s kitchen and replace with a modern shaker-style kitchen. Roughly 4m x 3.5m, would like an island if space allows. Hoping to start in the new year.",
        location: "Crawley",
        receivedAt: hoursAgo(3),
        status: "new",
        priority: "high",
        notes: [],
        suggestedReply:
          "Hi Hannah,\n\nThanks for getting in touch about your kitchen. A shaker-style kitchen with an island sounds great, and a new-year start should work well for us.\n\nWould you be able to send a few photos of the current space, plus rough measurements? Then we can arrange a time to come out and take a proper look.\n\nThanks,\nNinety3",
      },
      {
        id: "enq_wardrobes_horsham",
        customerName: "Tom Archer",
        instagramHandle: "@archer_home_demo",
        phone: "07700 900287",
        source: "instagram",
        title: "Fitted wardrobes",
        description:
          "Saw your alcove wardrobes on Instagram. After floor-to-ceiling fitted wardrobes in the main bedroom, sloped ceiling on one side. Can you give me a rough price?",
        location: "Horsham",
        receivedAt: hoursAgo(27),
        status: "awaiting_reply",
        priority: "high",
        notes: [
          {
            id: "note_seed_1",
            text: "Messaged twice now — keen customer, reply today.",
            createdAt: hoursAgo(6),
            author: "Office",
          },
        ],
        suggestedReply:
          "Hi Tom,\n\nThanks for the message, glad you liked the alcove wardrobes! Sloped ceilings are no problem, we do a lot of them.\n\nPrices depend on the width and finish, so if you can send a couple of photos and the rough width of the wall, I can give you a ballpark figure.\n\nCheers,\nNinety3",
      },
      {
        id: "enq_loft_eg",
        customerName: "Rachel Moore",
        email: "rachel.moore@example.com",
        phone: "07700 900315",
        source: "phone",
        title: "Loft conversion",
        description:
          "Called about a loft conversion with a dormer and en-suite. Semi-detached, 1930s. Wants an idea of cost before speaking to an architect.",
        location: "East Grinstead",
        receivedAt: daysAgo(5),
        status: "replied",
        priority: "medium",
        notes: [
          {
            id: "note_seed_2",
            text: "Spoke on the phone. Said we'd follow up with a ballpark once she sends the floor plan.",
            createdAt: daysAgo(4),
            author: "Owner",
          },
        ],
        suggestedReply:
          "Hi Rachel,\n\nJust following up on our chat about the loft conversion. If you're able to send over the floor plan (even a photo of the estate agent's one is fine), I'll put together a ballpark figure for you.\n\nThanks,\nNinety3",
        followUpDate: addDaysKey(0),
        lastContactAt: daysAgo(4),
      },
      {
        id: "enq_decking_hh",
        customerName: "Dave Collins",
        phone: "07700 900468",
        source: "phone",
        title: "Garden decking",
        description:
          "Left a voicemail. Wants raised composite decking, around 5m x 4m, with steps down to the lawn. Asked for a call back.",
        location: "Haywards Heath",
        receivedAt: daysAgo(2),
        status: "awaiting_reply",
        priority: "medium",
        notes: [],
        suggestedReply:
          "Hi Dave,\n\nSorry I missed your call. Thanks for thinking of us for the decking. I'll give you a ring today to have a chat, or let me know a good time to call.\n\nThanks,\nNinety3",
      },
      {
        id: "enq_stairs_bh",
        customerName: "Emma Clarke",
        instagramHandle: "@emma_c_interiors_demo",
        source: "instagram",
        title: "Staircase refurbishment",
        description:
          "Hi! Do you do staircase makeovers? Want to swap the spindles for glass and put oak treads on. Burgess Hill.",
        location: "Burgess Hill",
        receivedAt: hoursAgo(7),
        status: "new",
        priority: "low",
        notes: [],
        suggestedReply:
          "Hi Emma,\n\nYes, we definitely do! Glass balustrade with oak treads looks fantastic.\n\nCould you send a couple of photos of the staircase as it is now? Then we can give you an idea of cost and timings.\n\nThanks,\nNinety3",
      },
      {
        id: "enq_gardenroom_dorking",
        customerName: "Ben Taylor",
        email: "ben.taylor@example.com",
        phone: "07700 900533",
        source: "email",
        title: "Garden room",
        description:
          "Insulated garden office, approx 4m x 3m, with power. Quote sent last week, waiting to hear back.",
        location: "Dorking",
        receivedAt: daysAgo(12),
        status: "quoted",
        priority: "medium",
        notes: [
          {
            id: "note_seed_3",
            text: "Quote sent: £18,500 inc. electrics.",
            createdAt: daysAgo(8),
            author: "Owner",
          },
        ],
        suggestedReply:
          "Hi Ben,\n\nJust checking in to see if you had any questions about the garden room quote. Happy to talk through any options.\n\nThanks,\nNinety3",
        followUpDate: addDaysKey(2),
        lastContactAt: daysAgo(8),
      },
    ],
    jobs: [
      {
        id: "job_kitchen_crawley",
        customerName: "The Patels",
        customerPhone: "07700 900611",
        customerEmail: "patel.family@example.com",
        title: "Kitchen renovation",
        description: "Full kitchen refit with island, quartz worktops and new flooring.",
        location: "Crawley",
        kind: "kitchen",
        quotedValue: 12500,
        depositRequired: 5000,
        status: "in_progress",
        startDate: addDaysKey(-9),
        nextAction: "Order oak worktop offcuts for the island seating",
        notes: [
          {
            id: "note_seed_4",
            text: "Units fitted. Worktop template booked for Thursday.",
            createdAt: daysAgo(1),
            author: "Owner",
          },
        ],
        createdAt: daysAgo(30),
      },
      {
        id: "job_loft_eg",
        customerName: "Sarah Mitchell",
        customerPhone: "07700 900724",
        customerEmail: "sarah.mitchell@example.com",
        title: "Loft conversion",
        description: "Rear dormer loft conversion with en-suite shower room and Velux to the front.",
        location: "East Grinstead",
        kind: "loft",
        quotedValue: 28000,
        depositRequired: 5600,
        status: "awaiting_deposit",
        depositDueDate: addDaysKey(-2),
        startDate: addDaysKey(21),
        nextAction: "Chase deposit before confirming the start date",
        notes: [],
        createdAt: daysAgo(14),
      },
      {
        id: "job_wardrobes_horsham",
        customerName: "Grace Okafor",
        customerPhone: "07700 900835",
        title: "Fitted wardrobes",
        description: "Two alcove wardrobes and a dressing table in the main bedroom, painted finish.",
        location: "Horsham",
        kind: "wardrobes",
        quotedValue: 4800,
        depositRequired: 1440,
        status: "scheduled",
        depositDueDate: addDaysKey(3),
        startDate: addDaysKey(10),
        nextAction: "Confirm paint colour with Grace",
        notes: [],
        createdAt: daysAgo(6),
      },
      {
        id: "job_extension_copthorne",
        customerName: "Robert & Anne Fletcher",
        customerPhone: "07700 900946",
        customerEmail: "fletchers@example.com",
        title: "Single-storey extension",
        description: "Rear kitchen-diner extension, 5m x 4m, bi-fold doors and roof lantern.",
        location: "Copthorne",
        kind: "extension",
        quotedValue: 46000,
        depositRequired: 9200,
        status: "in_progress",
        startDate: addDaysKey(-35),
        nextAction: "Book skip swap for next week",
        notes: [],
        createdAt: daysAgo(60),
      },
      {
        id: "job_stairs_horley",
        customerName: "Mike Turner",
        customerPhone: "07700 900157",
        title: "Oak staircase",
        description: "Replacement oak staircase with glass balustrade.",
        location: "Horley",
        kind: "staircase",
        quotedValue: 6200,
        depositRequired: 1860,
        status: "snagging",
        startDate: addDaysKey(-18),
        nextAction: "Fix squeaky tread, then send final invoice",
        notes: [
          {
            id: "note_seed_5",
            text: "Customer happy overall. One tread squeaks — pop back Friday.",
            createdAt: daysAgo(2),
            author: "Owner",
          },
        ],
        createdAt: daysAgo(40),
      },
      {
        id: "job_gardenroom_lingfield",
        customerName: "Claire Dawson",
        customerPhone: "07700 900268",
        title: "Garden room",
        description: "Insulated garden studio with cedar cladding.",
        location: "Lingfield",
        kind: "general",
        quotedValue: 9500,
        depositRequired: 2850,
        status: "completed",
        startDate: addDaysKey(-50),
        notes: [],
        createdAt: daysAgo(75),
      },
    ],
    payments: [
      { id: "pay_1", jobId: "job_kitchen_crawley", amount: 5000, type: "deposit", method: "bank_transfer", receivedAt: addDaysKey(-20), reference: "PATEL DEP", recordedBy: "Office", recordedAt: daysAgo(20) },
      { id: "pay_2", jobId: "job_extension_copthorne", amount: 9200, type: "deposit", method: "bank_transfer", receivedAt: addDaysKey(-45), reference: "FLETCHER DEP", recordedBy: "Office", recordedAt: daysAgo(45) },
      { id: "pay_3", jobId: "job_extension_copthorne", amount: 12000, type: "stage", method: "bank_transfer", receivedAt: addDaysKey(-10), reference: "FLETCHER STG1", recordedBy: "Office", recordedAt: daysAgo(10) },
      { id: "pay_4", jobId: "job_stairs_horley", amount: 1860, type: "deposit", method: "bank_transfer", receivedAt: addDaysKey(-25), recordedBy: "Office", recordedAt: daysAgo(25) },
      { id: "pay_5", jobId: "job_gardenroom_lingfield", amount: 2850, type: "deposit", method: "bank_transfer", receivedAt: addDaysKey(-60), recordedBy: "Office", recordedAt: daysAgo(60) },
      { id: "pay_6", jobId: "job_gardenroom_lingfield", amount: 6650, type: "final", method: "bank_transfer", receivedAt: addDaysKey(-28), recordedBy: "Office", recordedAt: daysAgo(28) },
    ],
    reminders: [
      { id: "rem_1", title: "Call Dave Collins back about the decking", dueDate: addDaysKey(0), relatedType: "enquiry", relatedId: "enq_decking_hh", done: false, createdAt: daysAgo(2), createdBy: "Owner" },
      { id: "rem_2", title: "Chase Sarah Mitchell for the loft deposit", dueDate: addDaysKey(-1), relatedType: "job", relatedId: "job_loft_eg", done: false, createdAt: daysAgo(4), createdBy: "Office" },
      { id: "rem_3", title: "Order worktop offcuts for the Patel kitchen", dueDate: addDaysKey(1), relatedType: "job", relatedId: "job_kitchen_crawley", done: false, createdAt: daysAgo(1), createdBy: "Owner" },
      { id: "rem_4", title: "Book skip swap for the Fletcher extension", dueDate: addDaysKey(3), relatedType: "job", relatedId: "job_extension_copthorne", done: false, createdAt: daysAgo(1), createdBy: "Office" },
    ],
    activity: [
      { id: "act_1", at: hoursAgo(3), actor: "System", action: "enquiry.created", summary: "New email enquiry from Hannah Whitfield — kitchen renovation, Crawley", entityType: "enquiry", entityId: "enq_kitchen_crawley" },
      { id: "act_2", at: hoursAgo(7), actor: "System", action: "enquiry.created", summary: "New Instagram message from Emma Clarke — staircase, Burgess Hill", entityType: "enquiry", entityId: "enq_stairs_bh" },
      { id: "act_3", at: hoursAgo(6), actor: "Office", action: "enquiry.note_added", summary: "Note added to Tom Archer's wardrobe enquiry", entityType: "enquiry", entityId: "enq_wardrobes_horsham" },
      { id: "act_4", at: daysAgo(1), actor: "Owner", action: "job.note_added", summary: "Note added to the Patels' kitchen renovation", entityType: "job", entityId: "job_kitchen_crawley" },
      { id: "act_5", at: daysAgo(2), actor: "Owner", action: "job.status_changed", summary: "Mike Turner's oak staircase moved to Snagging", entityType: "job", entityId: "job_stairs_horley" },
      { id: "act_6", at: daysAgo(10), actor: "Office", action: "payment.recorded", summary: "£12,000 stage payment recorded for the Fletcher extension", entityType: "job", entityId: "job_extension_copthorne" },
    ],
  };
}
