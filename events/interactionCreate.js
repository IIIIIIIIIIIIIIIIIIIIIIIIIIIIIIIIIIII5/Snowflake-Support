import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { Octokit } from "octokit";

const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const OctokitClient = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function GetTickets() {
  const Res = await fetch(JsonBinUrl, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const Data = await Res.json();
  return Data.record || {};
}

async function SaveTickets(Tickets) {
  await fetch(JsonBinUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
    body: JSON.stringify(Tickets)
  });
}

function GenerateTranscriptHtml(ChannelName, Messages) {
  let Html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Transcript - ${ChannelName}</title><style>
  body{font-family:Arial,sans-serif;background:#111;color:#fff;padding:20px;}
  .message{margin-bottom:15px;padding:10px;border-radius:5px;background:#222;}
  .author{font-weight:bold;color:#fff;}
  .content{margin-top:5px;color:#ddd;}
  img{max-width:300px;margin-top:5px;border-radius:5px;}
  .timestamp{font-size:0.8em;color:#aaa;margin-top:3px;}
  </style></head><body><h1>Transcript for ${ChannelName}</h1>`;
  Messages.reverse().forEach(Msg => {
    Html += `<div class="message"><div class="author">${Msg.author.tag}</div><div class="content">${Msg.content || ""}</div>`;
    Msg.attachments.forEach(A => Html += `<img src="${A.url}" alt="Attachment">`);
    Html += `<div class="timestamp">${new Date(Msg.createdTimestamp).toLocaleString()}</div></div>`;
  });
  Html += `</body></html>`;
  return Html;
}

async function SyncPermissions(Channel, Category, OwnerId) {
  if (!Category) return;
  const Overwrites = Category.permissionOverwrites.cache.map(Po => ({
    id: Po.id,
    allow: new PermissionsBitField(Po.allow).bitfield,
    deny: new PermissionsBitField(Po.deny).bitfield
  }));
  await Channel.permissionOverwrites.set(Overwrites);
  await Channel.permissionOverwrites.edit(OwnerId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true
  });
}

function GetCategoryType(CategoryId) {
  if (CategoryId === process.env.REPORT_CATEGORY) return "Report";
  if (CategoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (CategoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

export default {
  name: "interactionCreate",
  async execute(Interaction, Client) {
    let ActiveTickets = await GetTickets();
    const Guild = Interaction.guild;
    const User = Interaction.user;

    if (!Client.TicketCounts) Client.TicketCounts = { Report: 0, Appeal: 0, Inquiry: 0 };

    for (const T of Object.values(ActiveTickets)) {
      if (T.categoryType && typeof T.ticketNumber === "number") {
        if (!Client.TicketCounts[T.categoryType] || Client.TicketCounts[T.categoryType] < T.ticketNumber) {
          Client.TicketCounts[T.categoryType] = T.ticketNumber;
        }
      }
    }

    if (Interaction.isChatInputCommand()) {
      const Command = Client.commands.get(Interaction.commandName);
      if (!Command) return;
      try { await Command.execute(Interaction, Client); } 
      catch (Err) { console.error(Err); Interaction.reply({ content: "Error executing command.", ephemeral: true }); }
      return;
    }

    if (Interaction.isStringSelectMenu() && Interaction.customId === "move_ticket") {
      const SelectedCategoryId = Interaction.values[0];
      if (!SelectedCategoryId) return Interaction.reply({ content: "Invalid category selected.", ephemeral: true });
      const OldCategory = Guild.channels.cache.get(Interaction.channel.parentId);
      await Interaction.channel.setParent(SelectedCategoryId).catch(() => {});
      const NewCategory = Guild.channels.cache.get(SelectedCategoryId);
      const TicketData = ActiveTickets[Interaction.channel.id];
      if (TicketData) await SyncPermissions(Interaction.channel, NewCategory, TicketData.ownerId);
      try {
        const Owner = await Client.users.fetch(TicketData.ownerId);
        const MoveEmbed = new EmbedBuilder()
          .setTitle("Ticket Moved")
          .setColor("Yellow")
          .setDescription(`Your ticket has been moved from **${OldCategory ? OldCategory.name : "Unknown"}** to **${NewCategory ? NewCategory.name : "Unknown"}**.`);
        await Owner.send({ embeds: [MoveEmbed] });
      } catch (Err) { console.error("Failed to DM ticket owner:", Err); }
      return Interaction.reply({ content: `Ticket moved to <#${SelectedCategoryId}> and synced permissions successfully.`, ephemeral: true });
    }

    if (!Interaction.isButton()) return;
    const TicketData = ActiveTickets[Interaction.channel.id];

    if (Interaction.customId.startsWith("confirm_close_")) {
      await Interaction.deferReply({ ephemeral: false });
      const Confirmed = Interaction.customId.endsWith("yes");
      const LogChannel = await Guild.channels.fetch("1417526499761979412").catch(() => null);
      if (!LogChannel?.isTextBased()) return Interaction.editReply({ content: "Log channel not found." });
      if (!TicketData) return Interaction.editReply({ content: "Ticket data not found." });
      if (!Confirmed) { await Interaction.message.edit({ content: "Ticket close cancelled.", components: [] }); await Interaction.editReply({ content: "Cancelled ticket closure." }); return; }

      const Messages = await Interaction.channel.messages.fetch({ limit: 100 });
      const Html = GenerateTranscriptHtml(Interaction.channel.name, Messages);
      const FilePath = path.join("/tmp", `${Interaction.channel.name}-transcript.html`);
      fs.writeFileSync(FilePath, Html);

      let GithubUrl = "";
      try {
        const Repo = process.env.GITHUB_REPO.split("/");
        const Content = Buffer.from(Html).toString("base64");
        await OctokitClient.rest.repos.createOrUpdateFileContents({
          owner: Repo[0],
          repo: Repo[1],
          path: `${Interaction.channel.id}/index.html`,
          message: `Add transcript for ticket ${Interaction.channel.id}`,
          content: Content,
          branch: "main"
        });
        GithubUrl = `https://${process.env.GITHUB_USER}.github.io/tickets/${Interaction.channel.id}/index.html`;
      } catch (Err) { console.error("GitHub upload failed:", Err); }

      const CloseEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .addFields(
          { name: "Ticket", value: Interaction.channel.name, inline: true },
          { name: "Closed by", value: User.tag, inline: true },
          { name: "Channel ID", value: Interaction.channel.id, inline: true }
        )
        .setColor("Red")
        .setTimestamp();

      const TranscriptButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(GithubUrl || "https://example.com")
      );

      await LogChannel.send({ embeds: [CloseEmbed], components: [TranscriptButton] });

      const CreatedAt = TicketData.createdAt ? new Date(TicketData.createdAt) : new Date();
      const ClosedAt = new Date();
      const DiffDays = Math.round((ClosedAt - CreatedAt) / (1000 * 60 * 60 * 24));
      const CategoryType = GetCategoryType(Interaction.channel.parentId);
      const TicketNumber = TicketData.ticketNumber;

      const DmEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .setColor("Red")
        .addFields(
          { name: "Ticket", value: `${CategoryType} #${TicketNumber}`, inline: false },
          { name: "Created At", value: CreatedAt.toLocaleString(), inline: true },
          { name: "Closed At", value: `${ClosedAt.toLocaleString()} (${DiffDays} day${DiffDays !== 1 ? "s" : ""})`, inline: true },
          { name: "Closed By", value: User.tag, inline: false }
        );

      const DmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(GithubUrl || "https://example.com")
      );

      try {
        const Owner = await Client.users.fetch(TicketData.ownerId);
        await Owner.send({ embeds: [DmEmbed], components: [DmButton] });
      } catch (Err) { console.error("Failed to DM user:", Err); }

      delete ActiveTickets[Interaction.channel.id];
      await SaveTickets(ActiveTickets);
      await Interaction.editReply({ content: "Ticket closed, transcript saved to log channel and GitHub." });
      await Interaction.message.edit({ components: [] });
      setTimeout(() => Interaction.channel.delete().catch(() => {}), 2000);
      return;
    }

    if (Interaction.customId === "close_ticket") {
      const ConfirmEmbed = new EmbedBuilder()
        .setTitle("Confirm Ticket Closure")
        .setDescription("Are you sure you want to close this ticket?")
        .setColor("Red");
      const ConfirmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_close_yes").setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("confirm_close_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await Interaction.reply({ embeds: [ConfirmEmbed], components: [ConfirmButtons], ephemeral: false });
      return;
    }

    if (Interaction.customId === "claim_ticket") {
      if (!TicketData) return Interaction.reply({ content: "Ticket data not found.", ephemeral: true });
      if (TicketData.claimerId) return Interaction.reply({ content: "This ticket is already claimed.", ephemeral: true });

      const Member = await Guild.members.fetch(User.id);
      const AllowedRoles = [
        "1403777886661644398",
        "1403777609522745485",
        "1403777335416848537",
        "1403777452517494784",
        "1403777162460397649",
        "1423280211239243826"
      ];

      const HasRole = Member.roles.cache.some(R => AllowedRoles.includes(R.id));
      if (!Member.permissions.has(PermissionsBitField.Flags.Administrator) && !HasRole) return Interaction.reply({ content: "You do not have permission to claim tickets.", ephemeral: true });

      TicketData.claimerId = User.id;
      ActiveTickets[Interaction.channel.id] = TicketData;
      await SaveTickets(ActiveTickets);

      const FetchedMessages = await Interaction.channel.messages.fetch({ limit: 10 });
      const TicketMessage = FetchedMessages.find(M => M.components.length > 0);
      if (TicketMessage) {
        const UpdatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await TicketMessage.edit({ components: [UpdatedRow] });
      }

      const Category = Interaction.channel.parent ? Guild.channels.cache.get(Interaction.channel.parentId) : null;
      if (Category) await SyncPermissions(Interaction.channel, Category, TicketData.ownerId);

      await Interaction.channel.permissionOverwrites.edit(TicketData.ownerId, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true
      });

      await Interaction.channel.permissionOverwrites.edit(TicketData.claimerId, {
        ViewChannel: true,
        SendMessages: true
      });

      await Interaction.reply({ content: `Ticket claimed by ${User.tag}`, ephemeral: false });
      return;
    }

    const TicketCategories = {
      Report: process.env.REPORT_CATEGORY,
      Appeal: process.env.APPEAL_CATEGORY,
      Inquiry: process.env.INQUIRY_CATEGORY
    };

    let CategoryId, Topic, Type;
    switch (Interaction.customId) {
      case "report_ticket": CategoryId = TicketCategories.Report; Topic = "Report a User"; Type = "Report"; break;
      case "appeal_ticket": CategoryId = TicketCategories.Appeal; Topic = "Appeal a Punishment"; Type = "Appeal"; break;
      case "inquiry_ticket": CategoryId = TicketCategories.Inquiry; Topic = "Inquiries"; Type = "Inquiry"; break;
      default: return;
    }

    const ExistingTicket = Object.values(ActiveTickets).find(
      T => T.ownerId === User.id && T.categoryType === Type
    );
    if (ExistingTicket) {
      return Interaction.reply({
        content: `You already have an open ${Type} ticket in this category. Please close it before creating a new one.`,
        ephemeral: true
      });
    }

    const Channel = await Guild.channels.create({
      name: `ticket-${User.username}`,
      type: ChannelType.GuildText,
      parent: CategoryId,
      topic: `${Topic} | Opened by ${User.tag}`
    });

    const Category = Guild.channels.cache.get(CategoryId);
    if (Category) await SyncPermissions(Channel, Category, User.id);

    await Channel.permissionOverwrites.edit(User.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true
    });

    Client.TicketCounts[Type] += 1;
    const TicketNumber = Client.TicketCounts[Type];

    ActiveTickets[Channel.id] = {
      ownerId: User.id,
      claimerId: null,
      createdAt: Date.now(),
      categoryType: Type,
      ticketNumber: TicketNumber
    };
    await SaveTickets(ActiveTickets);

    const Buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
    );

    const TicketEmbed = new EmbedBuilder()
      .setTitle(`${Topic} #${TicketNumber}`)
      .setDescription("A staff member will be with you shortly.\nPlease describe your issue below.")
      .setColor("Blue");

    await Channel.send({ content: `${User}`, embeds: [TicketEmbed], components: [Buttons] });
    await Interaction.reply({ content: `Ticket created: ${Channel}`, ephemeral: true });
  }
};
